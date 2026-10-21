"""Hand-written list of demo products."""

from datetime import datetime

from matchpoint.models import Product

PRODUCTS: tuple[Product, ...] = (
    Product(
        id="prd_target_savings",
        name="Target savings account",
        category="savings",
        is_credit=False,
        features=["Set a goal", "Automatic monthly transfer"],
        eligibility={"all": [
            {"fact": "age", "op": ">=", "value": 18},
            {"fact": "holds", "op": "not_contains", "value": "prd_target_savings"},
        ]},
        version=3,
        key_facts=["No monthly fee", "Goal reminders", "Interest on balance"],
        gain_model="salary_regular + fee_season",
        compare_group="salaried-no-savings-goal",
    ),
    Product(
        id="prd_business_collections",
        name="Business collections account",
        category="business",
        is_credit=False,
        features=["POS-ready", "Settlement in 24h", "USSD-friendly"],
        eligibility={"all": [
            {"fact": "segment", "op": "in", "value": ["trader", "sme"]},
            {"fact": "holds", "op": "not_contains", "value": "prd_business_collections"},
        ]},
        version=2,
        key_facts=["Faster settlement", "POS without upfront cost", "USSD check"],
        gain_model="pos_inflow_growth",
        compare_group="sme-growing-inflows",
    ),
    Product(
        id="prd_savings_round_up",
        name="Round-up savings",
        category="savings",
        is_credit=False,
        features=["Rounds spare change", "Visible balance", "Withdraw any time"],
        eligibility={"all": [
            {"fact": "age", "op": ">=", "value": 18},
        ]},
        version=1,
        key_facts=["No monthly fee", "No lock-in"],
        gain_model="small_frequent_spend",
        compare_group="salaried-active-pos",
    ),
    Product(
        id="prd_personal_loan",
        name="Personal loan",
        category="credit",
        is_credit=True,
        features=["Fixed monthly repayment", "Up to 24 months"],
        eligibility={"all": [
            {"fact": "age", "op": ">=", "value": 21},
            {"fact": "segment", "op": "in", "value": ["salaried"]},
            {"fact": "holds", "op": "not_contains", "value": "personal_loan"},
        ]},
        version=4,
        key_facts=["Fixed APR", "No early-repayment penalty"],
        gain_model="salary_regular + no_existing_loan",
        compare_group="salaried-no-active-loan",
    ),
    Product(
        id="prd_fx_card",
        name="Dollar FX card",
        category="cards",
        is_credit=False,
        features=["Spend in USD", "Online payments abroad"],
        eligibility={"all": [
            {"fact": "age", "op": ">=", "value": 18},
            {"fact": "segment", "op": "in", "value": ["salaried", "sme"]},
        ]},
        version=1,
        key_facts=["$10/year", "Instant freeze in app"],
        gain_model="international_spend",
        compare_group="salaried-abroad",
    ),
    Product(
        id="prd_bills_autopay",
        name="Bills autopay",
        category="service",
        is_credit=False,
        features=["Schedule DSTV, power and water", "Pause any time"],
        eligibility={"all": [
            {"fact": "age", "op": ">=", "value": 18},
        ]},
        version=1,
        key_facts=["No service charge", "Reminders before each run"],
        gain_model="recurring_bill_pattern",
        compare_group="salaried-active-bills",
    ),
)


class SimCatalogueTransport:
    def active(self, as_of: datetime) -> list[Product]:
        return list(PRODUCTS)
