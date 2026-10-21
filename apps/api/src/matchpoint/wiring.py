"""Build the six adapters. Services get this result; nothing else imports the simulator.

In sim mode every connector sits over the sim transport. In pilot mode the HTTP
transports go here; they are not stubbed in the hackathon build.
"""

from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache

from matchpoint.adapters.channels.gateway import ChannelGatewayImpl
from matchpoint.adapters.consent.connector import ConsentStoreImpl
from matchpoint.adapters.products.connector import ProductCatalogueImpl
from matchpoint.adapters.profile.connector import CustomerProfileImpl
from matchpoint.adapters.purpose import AccessLog, purpose_filtered
from matchpoint.adapters.refs import RefHasher
from matchpoint.adapters.rewards.connector import SimRewardsFulfilment
from matchpoint.adapters.transactions.connector import FlexcubeTransactionFeed
from matchpoint.clock import WAT, Clock
from matchpoint.config import Settings, get_settings
from matchpoint.ledger.decision_log import DecisionLog
from matchpoint.models import Channel
from matchpoint.pipeline.policy import DEFAULT_POLICY, Policy
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
    hasher: RefHasher
    access_log: AccessLog


def build_adapters(settings: Settings, seed: int, clock: Clock) -> Adapters:
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

    return Adapters(
        transactions=purpose_filtered(txn_connector, "TransactionFeed", access, clock),
        consent=purpose_filtered(consent_connector, "ConsentStore", access, clock),
        channels=purpose_filtered(channel_connector, "ChannelGateway", access, clock),
        profile=purpose_filtered(profile_connector, "CustomerProfile", access, clock),
        catalogue=purpose_filtered(catalogue_connector, "ProductCatalogue", access, clock),
        rewards=purpose_filtered(rewards_connector, "RewardsFulfilment", access, clock),
        hasher=hasher,
        access_log=access,
    )


# The simulator's fixed start, from docs/api_design.md section 2.
DEFAULT_SEED = 42
DEFAULT_AS_OF = datetime(2026, 12, 3, 9, 0, tzinfo=WAT)


@dataclass(frozen=True)
class Runtime:
    """What a request needs: connectors, the injected clock, the policy and the log."""

    clock: Clock
    adapters: Adapters
    policy: Policy
    log: DecisionLog


def build_runtime(
    settings: Settings, seed: int = DEFAULT_SEED, as_of: datetime = DEFAULT_AS_OF
) -> Runtime:
    clock = SimClock(as_of)
    return Runtime(
        clock=clock,
        adapters=build_adapters(settings, seed, clock),
        policy=DEFAULT_POLICY,
        log=DecisionLog(),
    )


@lru_cache
def get_runtime() -> Runtime:
    """One runtime per process, so consent changes and the decision log persist."""
    return build_runtime(get_settings())


def demo_customer_refs(settings: Settings | None = None) -> dict[str, str]:
    """key -> customer_ref for the seven demo customers. Refs are stable HMACs."""
    hasher = RefHasher((settings or get_settings()).ref_hmac_key.encode(), namespace="customer")
    return {c.key: hasher.ref(c.source_id) for c in DEMO_CUSTOMERS}


