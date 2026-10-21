"""Earn rules, caps, tier thresholds and catalogue for the rewards service."""

EARN = {
    "consent_granted": {"points": 50, "once_per_purpose": True},
    "preferences_reviewed": {"points": 20, "max_per_year": 1},
    "offer_feedback": {"points": 5, "max_per_30d": 2},
    "product_use_milestone": {
        "points": 100,
        "once_per_product": True,
        "requires_days": 60,
    },
}

MAX_POINTS_PER_30D = 150

TIERS = [("Base", 0), ("Silver", 200), ("Gold", 600)]

CATALOGUE = [
    {"id": "rwi_airtime_500", "name": "Airtime \u20a6500", "points": 100, "kind": "airtime"},
    {"id": "rwi_fee_waiver", "name": "Transfer fee waiver", "points": 150, "kind": "fee_waiver"},
    {"id": "rwi_voucher_1000", "name": "\u20a61,000 voucher", "points": 300, "kind": "voucher"},
]

CONSENT_REQUIRED_EVENTS = {"offer_feedback", "preferences_reviewed"}

REWARD_INELIGIBLE = "REWARD_INELIGIBLE"
REWARD_DUPLICATE = "REWARD_DUPLICATE"
REWARD_NO_CONSENT = "REWARD_NO_CONSENT"
REWARD_CAP_REACHED = "REWARD_CAP_REACHED"
INSUFFICIENT_POINTS = "INSUFFICIENT_POINTS"
