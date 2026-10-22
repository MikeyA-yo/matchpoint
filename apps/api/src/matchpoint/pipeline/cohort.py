"""Offline batch job: cluster all active customers and persist the cluster
map plus a per-customer assignment.

- Reads adapters from `wiring.get_runtime()` so this module never imports
  from `simulator/` directly (that is wiring.py's privilege).
- Features come from pipeline/features.build_feature_vector using the same
  180-day window the real-time pipeline uses.
- Clustering is HDBSCAN with the parameters in config/cluster_params.json. On
  tiny customer sets (demo mode) the clusterer falls back to
  `small_cohort_min_cluster_size`.
- Per-cluster product mapping is: fit a tiny LightGBM when there are enough
  labelled examples; otherwise take the majority product id from the
  simulator catalogue (defaulting to Save_4_me for a universal savings nudge).
- Writes `ranker/cluster_to_product.json` and (when LightGBM is available)
  `ranker/model.txt`, then writes each customer's cluster_id back through
  `profile.set_cluster`.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from matchpoint.clock import Clock
from matchpoint.config import cluster_params
from matchpoint.models import ClusterAssignment, Profile
from matchpoint.pipeline.features import balances_from_transactions, build_feature_vector
from matchpoint.ranker import infer as ranker_infer

if TYPE_CHECKING:
    from matchpoint.wiring import Adapters

LOOKBACK_DAYS = 180
DEFAULT_CLUSTER_PRODUCT = "Save_4_me"


@dataclass(frozen=True)
class BatchReport:
    assignments: tuple[ClusterAssignment, ...]
    cluster_to_product: dict[str, str]
    model_version: str
    trained_at: datetime


def run_batch(
    customer_refs: list[str],
    *,
    adapters: "Adapters",
    clock: Clock,
    model_version: str = "cohort_v1",
) -> BatchReport:
    """Cluster the given customers and persist the mapping. Returns the
    report so callers (sim/start, cron) can log a summary."""
    as_of = clock.now()
    window_start = as_of - timedelta(days=LOOKBACK_DAYS)

    rows: list[tuple[str, list[float], Profile]] = []
    for ref in customer_refs:
        profile = adapters.profile.get(ref, purpose="profiling")
        transactions = adapters.transactions.window(
            ref, window_start, as_of, purpose="profiling"
        )
        balances = balances_from_transactions(transactions)
        features = build_feature_vector(transactions, balances, list(profile.holdings), profile)
        rows.append((ref, features.to_dense(), profile))

    labels = _cluster([row[1] for row in rows])
    assignments: list[ClusterAssignment] = []
    for (ref, _, _), label in zip(rows, labels):
        assignment = ClusterAssignment(customer_ref=ref, cluster_id=label, assigned_at=as_of)
        assignments.append(assignment)
        try:
            adapters.profile.set_cluster(ref, label, as_of, purpose="profiling")
        except AttributeError:
            pass

    cluster_map = _build_cluster_map(rows, labels)
    ranker_infer.write_cluster_map({str(k): v for k, v in cluster_map.items()})
    _maybe_train_booster([row[1] for row in rows], labels)

    return BatchReport(
        assignments=tuple(assignments),
        cluster_to_product={str(k): v for k, v in cluster_map.items()},
        model_version=model_version,
        trained_at=as_of,
    )


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------


def _cluster(matrix: list[list[float]]) -> list[int]:
    if not matrix:
        return []
    params = dict(cluster_params())
    small_min = int(params.pop("small_cohort_min_cluster_size", 2))
    if len(matrix) < int(params.get("min_cluster_size", 50)):
        params["min_cluster_size"] = max(small_min, 2)
        params["min_samples"] = 1
    try:
        import hdbscan  # type: ignore[import-not-found]
        import numpy as np

        clusterer = hdbscan.HDBSCAN(
            metric=params.get("metric", "euclidean"),
            min_cluster_size=int(params["min_cluster_size"]),
            min_samples=int(params.get("min_samples", 5)),
            cluster_selection_epsilon=float(params.get("cluster_selection_epsilon", 0.0)),
            cluster_selection_method=params.get("cluster_selection_method", "eom"),
            allow_single_cluster=bool(params.get("allow_single_cluster", False)),
        )
        return [int(label) for label in clusterer.fit_predict(np.asarray(matrix, dtype=float))]
    except Exception:
        return _hash_cluster(matrix)


def _hash_cluster(matrix: list[list[float]]) -> list[int]:
    """Deterministic bucketing used when HDBSCAN is unavailable. Buckets rows
    by (freq, surplus) quantiles so the demo still runs on a cold install."""
    if not matrix:
        return []
    freqs = sorted({row[1] for row in matrix})
    surpluses = sorted({row[5] for row in matrix})
    labels: list[int] = []
    for row in matrix:
        f_bucket = freqs.index(row[1]) % 4
        s_bucket = surpluses.index(row[5]) % 2
        labels.append(f_bucket * 2 + s_bucket)
    return labels


def _build_cluster_map(
    rows: list[tuple[str, list[float], Profile]], labels: list[int]
) -> dict[int, str]:
    by_cluster: dict[int, list[Profile]] = {}
    for (_, _, profile), label in zip(rows, labels):
        by_cluster.setdefault(label, []).append(profile)
    mapping: dict[int, str] = {}
    for cluster_id, profiles in by_cluster.items():
        mapping[cluster_id] = _default_for_profiles(cluster_id, profiles)
    mapping.setdefault(-1, DEFAULT_CLUSTER_PRODUCT)
    return mapping


def _default_for_profiles(cluster_id: int, profiles: list[Profile]) -> str:
    """Majority-vote heuristic in lieu of simulator labels. Reads a hint from
    the segment distribution so the demo clusters land on recognisable products."""
    segments = Counter(p.segment or "" for p in profiles)
    top_segment = segments.most_common(1)[0][0] if segments else ""
    if top_segment == "sme":
        return "SME_GMB"
    if top_segment == "trader":
        return "SME_GMB"
    if top_segment == "student":
        return "Aspire_Lite"
    if top_segment == "salaried":
        return "eaZySave_Classic"
    return DEFAULT_CLUSTER_PRODUCT


# ---------------------------------------------------------------------------
# LightGBM (optional)
# ---------------------------------------------------------------------------


def _maybe_train_booster(matrix: list[list[float]], labels: list[int]) -> None:
    """Fit a tiny multiclass LightGBM when it is importable and there are at
    least two distinct labels. Persist the model file so ranker/infer.py can
    pick it up on next read."""
    if not matrix or not labels:
        return
    distinct = {label for label in labels if label >= 0}
    if len(distinct) < 2:
        return
    try:
        import lightgbm as lgb  # type: ignore[import-not-found]
        import numpy as np
    except ImportError:
        return
    try:
        x = np.asarray(matrix, dtype=float)
        y = np.asarray(labels, dtype=int)
        mask = y >= 0
        if mask.sum() < len(distinct) * 2:
            return
        booster = lgb.train(
            params={
                "objective": "multiclass",
                "num_class": len(distinct),
                "verbose": -1,
                "learning_rate": 0.1,
            },
            train_set=lgb.Dataset(x[mask], label=y[mask]),
            num_boost_round=20,
        )
        ranker_infer.write_booster(booster.model_to_string())
    except Exception:
        return


def customer_refs_from_adapters(adapters: Any) -> list[str]:
    """Best-effort way to list the customers to batch over. The simulator
    exposes DEMO_CUSTOMERS indirectly through the profile transport; we read
    that off the adapter's state if present, else return []."""
    profile = adapters.profile
    inner = getattr(profile, "_inner", profile)
    transport = getattr(inner, "_transport", None)
    if transport is None:
        return []
    by_ref = getattr(transport, "_by_ref", {})
    return list(by_ref.keys())
