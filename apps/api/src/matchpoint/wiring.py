"""Build the six adapters. Services get this result; nothing else imports the simulator.

In sim mode every connector sits over the sim transport. In pilot mode the HTTP
transports go here; they are not stubbed in the hackathon build.
"""

from dataclasses import dataclass
from datetime import datetime

from matchpoint.adapters.channels.gateway import ChannelGatewayImpl
from matchpoint.adapters.consent.connector import ConsentStoreImpl
from matchpoint.adapters.errors import CustomerNotFound
from matchpoint.adapters.products.connector import ProductCatalogueImpl
from matchpoint.adapters.profile.connector import CustomerProfileImpl
from matchpoint.adapters.purpose import AccessLog, purpose_filtered
from matchpoint.adapters.refs import RefHasher
from matchpoint.adapters.rewards.connector import SimRewardsFulfilment
from matchpoint.adapters.transactions.connector import FlexcubeTransactionFeed
from matchpoint.clock import Clock
from matchpoint.config import Settings, get_settings
from matchpoint.customer.message_log import message_store
from matchpoint.errors import ApiError
from matchpoint.events.bus import EventBus
from matchpoint.ledger.decision_log import DecisionLog
from matchpoint.models import Channel
from matchpoint.pipeline.policy import DEFAULT_POLICY, Policy
from matchpoint.rewards.ledger import RewardsLedger
from matchpoint.simulator import control
from matchpoint.simulator.clock import SimClock
from matchpoint.simulator.population import DEMO_CUSTOMERS
from matchpoint.simulator.transports.catalogue import SimCatalogueTransport
from matchpoint.simulator.transports.channels import (
    SimAppTransport,
    SimSmsTransport,
    SimUssdTransport,
    SimWhatsAppTransport,
    build_sms_dnd,
)
from matchpoint.simulator.transports.consent import SimConsentTransport
from matchpoint.simulator.transports.flexcube import SimFlexcubeTransport
from matchpoint.simulator.transports.profile import SimProfileTransport


@dataclass(frozen=True)
class Adapters:
    transactions: object
    consent: object
    channels: object
    profile: object
    catalogue: object
    rewards: object
    message_store: object
    hasher: RefHasher
    access_log: AccessLog


def build_adapters(
    settings: Settings, seed: int, clock: SimClock
) -> tuple[Adapters, control.SimWorld]:
    if settings.adapter_mode != "sim":
        raise NotImplementedError("pilot mode is a hackathon TODO")

    hasher = RefHasher(settings.ref_hmac_key.encode(), namespace="customer")
    access = AccessLog()

    # Transactions
    flexcube = SimFlexcubeTransport(seed, hasher)
    txn_connector = FlexcubeTransactionFeed(flexcube)

    # Consent
    consent_connector = ConsentStoreImpl(SimConsentTransport(hasher, clock), clock)

    # Channels
    channel_transports: dict[Channel, object] = {
        "app": SimAppTransport(),
        "whatsapp": SimWhatsAppTransport(),
        "sms": SimSmsTransport(build_sms_dnd(hasher)),
        "ussd": SimUssdTransport(),
        "email": SimAppTransport(),  # same behaviour as app; email isn't a demo channel
    }
    channel_connector = ChannelGatewayImpl(channel_transports, clock)

    # Profile, catalogue, rewards
    profile_connector = CustomerProfileImpl(SimProfileTransport(hasher))
    catalogue_connector = ProductCatalogueImpl(SimCatalogueTransport())
    rewards_connector = SimRewardsFulfilment(clock)

    return (
        Adapters(
            transactions=purpose_filtered(txn_connector, "TransactionFeed", access, clock),
            consent=purpose_filtered(consent_connector, "ConsentStore", access, clock),
            channels=purpose_filtered(channel_connector, "ChannelGateway", access, clock),
            profile=purpose_filtered(profile_connector, "CustomerProfile", access, clock),
            catalogue=purpose_filtered(catalogue_connector, "ProductCatalogue", access, clock),
            rewards=purpose_filtered(rewards_connector, "RewardsFulfilment", access, clock),
            message_store=message_store,
            hasher=hasher,
            access_log=access,
        ),
        control.SimWorld(clock, flexcube),
    )


# The simulator's fixed start, from docs/api_design.md section 2.
DEFAULT_SEED = control.DEFAULT_SEED
DEFAULT_AS_OF = control.SIM_START


@dataclass(frozen=True)
class Runtime:
    """What a request needs: connectors, the injected clock, the policy, the log and the bus."""

    clock: Clock
    adapters: Adapters
    policy: Policy
    log: DecisionLog
    sim: control.SimWorld
    events: EventBus
    rewards: RewardsLedger


def build_runtime(
    settings: Settings,
    seed: int = DEFAULT_SEED,
    as_of: datetime = DEFAULT_AS_OF,
    events: EventBus | None = None,
) -> Runtime:
    clock = SimClock(as_of)
    adapters, sim = build_adapters(settings, seed, clock)
    return Runtime(
        clock=clock,
        adapters=adapters,
        policy=DEFAULT_POLICY,
        log=DecisionLog(),
        sim=sim,
        events=events if events is not None else EventBus(),
        rewards=RewardsLedger(),
    )


_runtime: Runtime | None = None


def get_runtime() -> Runtime:
    """One runtime per process, so consent changes and the decision log persist."""
    global _runtime
    if _runtime is None:
        _runtime = build_runtime(get_settings())
    return _runtime


def reset_runtime(seed: int = DEFAULT_SEED) -> Runtime:
    """A fresh world behind the same event bus, so open streams are not orphaned."""
    global _runtime
    events = _runtime.events if _runtime is not None else EventBus()
    _runtime = build_runtime(get_settings(), seed=seed, events=events)
    message_store.clear()
    return _runtime


def sim_start(seed: int, n_customers: int, days: int, scenario: str) -> control.SimState:
    """Begin a run: the seed reseeds the data, so the runtime is rebuilt around it."""
    runtime = reset_runtime(seed)
    config = control.SimConfig(
        seed=seed, n_customers=n_customers, days=days, scenario=scenario
    )
    return runtime.sim.start(config)


def sim_reset() -> control.SimState:
    return reset_runtime().sim.state()


def sim_state() -> control.SimState:
    return get_runtime().sim.state()


def sim_inject(
    pattern: control.Pattern, customer_ref: str | None
) -> control.InjectResult:
    runtime = get_runtime()
    if not runtime.sim.running:
        raise ApiError(
            409, "SIM_NOT_STARTED", "Start the simulator first (POST /sim/start)."
        )
    if customer_ref is not None:
        answer = runtime.adapters.profile.exists(customer_ref, purpose="service")
        if not answer.exists:
            raise CustomerNotFound("CustomerProfile", f"unknown {customer_ref}")
    return runtime.sim.inject(pattern, customer_ref)


def demo_customer_refs(settings: Settings | None = None) -> dict[str, str]:
    """key -> customer_ref for the seven demo customers. Refs are stable HMACs."""
    hasher = RefHasher((settings or get_settings()).ref_hmac_key.encode(), namespace="customer")
    return {c.key: hasher.ref(c.source_id) for c in DEMO_CUSTOMERS}


