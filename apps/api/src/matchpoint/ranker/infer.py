"""Fallback ranker used when a customer has no persisted cluster assignment.

In order of preference:

1. If `model.txt` exists and LightGBM is importable, run the booster on the
   dense feature vector and return a sorted list of (product_id, score).
2. If `cluster_to_product.json` has a `"-1"` entry, return that single product
   as the recommendation.
3. Otherwise, return an empty list and the caller decides what to do.

The map and model file are read lazily and cached.
"""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from pathlib import Path
from typing import Any

from matchpoint.models import FeatureVector

MODEL_FILE = "model.txt"
MAP_FILE = "cluster_to_product.json"


def score_products(features: FeatureVector) -> list[tuple[str, float]]:
    booster = _load_booster()
    classes = _booster_classes()
    if booster is not None and classes:
        import numpy as np

        probs = booster.predict(np.asarray([features.to_dense()], dtype=float))
        row = probs[0]
        ranked = sorted(zip(classes, row, strict=False), key=lambda x: -x[1])
        return [(cls, float(score)) for cls, score in ranked]
    noise = cluster_to_product().get("-1")
    if noise:
        return [(noise, 1.0)]
    return []


def cluster_to_product() -> dict[str, str]:
    return _load_cluster_map()


@lru_cache(maxsize=1)
def _load_cluster_map() -> dict[str, str]:
    try:
        text = resources.files(__package__).joinpath(MAP_FILE).read_text("utf-8")
    except FileNotFoundError:
        return {}
    data = json.loads(text)
    return {str(k): str(v) for k, v in data.items()}


@lru_cache(maxsize=1)
def _load_booster() -> Any | None:
    try:
        import lightgbm as lgb  # type: ignore[import-not-found]
    except ImportError:
        return None
    path = Path(str(resources.files(__package__).joinpath(MODEL_FILE)))
    if not path.exists() or path.stat().st_size == 0:
        return None
    try:
        return lgb.Booster(model_file=str(path))
    except Exception:
        return None


@lru_cache(maxsize=1)
def _booster_classes() -> list[str]:
    """LightGBM boosters saved via `booster.save_model` carry their class
    labels in the model file. If we cannot parse them, return []."""
    booster = _load_booster()
    if booster is None:
        return []
    try:
        attrs = booster.model_to_string()
    except Exception:
        return []
    for line in attrs.splitlines():
        if line.startswith("objective=multiclass") and "num_class=" in line:
            # fall through: num_class is informational; labels come separately
            continue
        if line.startswith("[class_label]"):
            parts = line.split("=", 1)
            if len(parts) == 2:
                return [c.strip() for c in parts[1].split(",") if c.strip()]
    return []


def write_cluster_map(mapping: dict[str, str]) -> None:
    """Persist the cluster map alongside the ranker package (used by
    pipeline/cohort.run_batch). Takes a dict with str keys."""
    path = Path(str(resources.files(__package__).joinpath(MAP_FILE)))
    path.write_text(json.dumps(mapping, indent=2, sort_keys=True), encoding="utf-8")
    _load_cluster_map.cache_clear()


def write_booster(model_text: str) -> None:
    """Persist a LightGBM booster to the ranker package."""
    path = Path(str(resources.files(__package__).joinpath(MODEL_FILE)))
    path.write_text(model_text, encoding="utf-8")
    _load_booster.cache_clear()
    _booster_classes.cache_clear()
