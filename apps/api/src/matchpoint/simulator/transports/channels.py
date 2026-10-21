"""Four demo channel transports.

- app, whatsapp: accepted.
- sms:
    * default: accepted.
    * if the recipient has `blocks_marketing` on and the message is marketing: rejected, DND.
    * if the clock reads 20:00 WAT or later and the message is marketing: rejected, OUTSIDE_WINDOW.
- ussd: queued, SESSION_ONLY (USSD can't push).

Phone numbers are "+234-xxx-DEMO" so nothing in the demo looks like a real MSISDN.
"""

from datetime import datetime, time

from matchpoint.adapters.refs import RefHasher
from matchpoint.models import DeliveryReceipt, OutboundMessage
from matchpoint.simulator.population import DEMO_CUSTOMERS

# NCC-cited promotional window: 08:00–20:00 WAT. UNVERIFIED (2016 directive).
SMS_PROMOTIONAL_END = time(20, 0)
SMS_PROMOTIONAL_START = time(8, 0)


def _msisdn_map(hasher: RefHasher) -> dict[str, str]:
    out: dict[str, str] = {}
    for i, c in enumerate(DEMO_CUSTOMERS, start=1):
        out[hasher.ref(c.source_id)] = f"+234-{700 + i:03d}-DEMO"
    return out


class SimAppTransport:
    def send(self, msg: OutboundMessage, at: datetime) -> DeliveryReceipt:
        return DeliveryReceipt(
            message_id=msg.id, channel="app", accepted=True, at=at,
            status="accepted", provider_ref=f"app:{msg.id}",
        )


class SimWhatsAppTransport:
    def send(self, msg: OutboundMessage, at: datetime) -> DeliveryReceipt:
        return DeliveryReceipt(
            message_id=msg.id, channel="whatsapp", accepted=True, at=at,
            status="accepted", provider_ref=f"wa:{msg.id}",
        )


class SimSmsTransport:
    """DND and quiet-hours checks only apply to promotional SMS."""

    def __init__(self, blocks_marketing: set[str]):
        self._dnd = blocks_marketing

    def send(self, msg: OutboundMessage, at: datetime) -> DeliveryReceipt:
        if msg.kind == "marketing":
            if msg.customer_ref in self._dnd:
                return DeliveryReceipt(
                    message_id=msg.id, channel="sms", accepted=False, at=at,
                    status="rejected", reason="DND",
                )
            local = at.timetz()
            if not (SMS_PROMOTIONAL_START <= local.replace(tzinfo=None) < SMS_PROMOTIONAL_END):
                return DeliveryReceipt(
                    message_id=msg.id, channel="sms", accepted=False, at=at,
                    status="rejected", reason="OUTSIDE_WINDOW",
                )
        return DeliveryReceipt(
            message_id=msg.id, channel="sms", accepted=True, at=at,
            status="accepted", provider_ref=f"sms:{msg.id}",
        )


class SimUssdTransport:
    """USSD is pull-only: an offer waits for the customer's next session."""

    def send(self, msg: OutboundMessage, at: datetime) -> DeliveryReceipt:
        return DeliveryReceipt(
            message_id=msg.id, channel="ussd", accepted=False, at=at,
            status="queued", reason="SESSION_ONLY",
        )


def build_sms_dnd(hasher: RefHasher) -> set[str]:
    """Customers with an open complaint block marketing SMS."""
    return {hasher.ref(c.source_id) for c in DEMO_CUSTOMERS if c.blocks_marketing}
