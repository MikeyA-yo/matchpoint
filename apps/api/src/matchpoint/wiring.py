"""Build the six adapters. Services get this result; nothing else imports the simulator.

In sim mode every connector sits over the sim transport. In pilot mode the HTTP
transports go here; they are not stubbed in the hackathon build.
"""

from dataclasses import dataclass

from matchpoint.adapters.channels.gateway import ChannelGatewayImpl
from matchpoint.adapters.consent.connector import ConsentStoreImpl
from matchpoint.adapters.products.connector import ProductCatalogueImpl
from matchpoint.adapters.profile.connector import CustomerProfileImpl
from matchpoint.adapters.purpose import AccessLog, purpose_filtered
from matchpoint.adapters.refs import RefHasher
from matchpoint.adapters.rewards.connector import SimRewardsFulfilment
from matchpoint.adapters.transactions.connector import FlexcubeTransactionFeed
from matchpoint.clock import Clock
from matchpoint.config import Settings
from matchpoint.models import Channel
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


