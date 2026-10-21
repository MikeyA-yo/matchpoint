"""Step 5 helper: evaluate eligibility, score fit and emit candidates.

Eligibility is data, not code: each product carries facts and operators. Age comes from
a band, so the lower edge is used and the demo never pretends to know a birthday. A
product the customer already holds is dropped before eligibility runs, because
"already holds" is more useful to the console than a failed eligibility fact.
"""

from __future__ import annotations

from typing import Any

from matchpoint.models import Product, Profile
from matchpoint.pipeline.context import ScoredProduct
from matchpoint.pipeline.detector import Signal

UPLIFT_SCALE = 10.0


def age_from_band(band: str | None) -> int | None:
    if not band:
        return None
    head = band.split("-")[0].rstrip("+")
    try:
        return int(head)
    except ValueError:
        return None


def evaluate_eligibility(product: Product, profile: Profile) -> tuple[bool, str]:
    for rule in product.eligibility.get("all", []):
        if not _matches(rule, profile):
            return False, _failed_detail(rule, profile)
    for rule in product.eligibility.get("any", []):
        if _matches(rule, profile):
            return True, "an eligibility rule passed"
    if product.eligibility.get("any"):
        return False, "no eligibility rule passed"
    return True, "all eligibility rules passed"


def score_product(product: Product, signals: list[Signal]) -> int:
    return sum(product.fit.get(signal.type, 0) for signal in signals)


def build_candidates(
    products: list[Product], profile: Profile, signals: list[Signal]
) -> list[ScoredProduct]:
    candidates: list[ScoredProduct] = []
    for product in products:
        if product.holding_id and product.holding_id in profile.holdings:
            candidates.append(
                ScoredProduct(
                    product, eligible=False, score=0, uplift=0.0, dropped="ALREADY_HOLDS"
                )
            )
            continue
        eligible, detail = evaluate_eligibility(product, profile)
        if not eligible:
            candidates.append(
                ScoredProduct(
                    product,
                    eligible=False,
                    score=0,
                    uplift=0.0,
                    dropped="NOT_ELIGIBLE",
                )
            )
            continue
        score = score_product(product, signals)
        if score <= 0:
            continue
        candidates.append(
            ScoredProduct(
                product,
                eligible=True,
                score=score,
                uplift=round(score / UPLIFT_SCALE, 3),
            )
        )
    candidates.sort(key=lambda c: (c.product.is_credit, -c.score, c.product.id))
    return candidates


def _fact(name: str, profile: Profile) -> Any:
    if name == "age":
        return age_from_band(profile.age_band)
    if name == "segment":
        return profile.segment
    if name == "state":
        return profile.state
    if name == "holds":
        return profile.holdings
    return None


def _matches(rule: dict[str, Any], profile: Profile) -> bool:
    actual = _fact(rule.get("fact", ""), profile)
    expected = rule.get("value")
    op = rule.get("op")
    if actual is None:
        return False
    try:
        if op == ">=":
            return actual >= expected
        if op == "<=":
            return actual <= expected
        if op == "==":
            return actual == expected
        if op == "!=":
            return actual != expected
        if op == "in":
            return actual in expected
        if op == "not_in":
            return actual not in expected
        if op == "contains":
            return expected in actual
        if op == "not_contains":
            return expected not in actual
    except TypeError:
        return False
    return False


def _failed_detail(rule: dict[str, Any], profile: Profile) -> str:
    actual = _fact(rule.get("fact", ""), profile)
    return (
        f"{rule.get('fact')} {rule.get('op')} {rule.get('value')} failed "
        f"(actual: {actual})"
    )
