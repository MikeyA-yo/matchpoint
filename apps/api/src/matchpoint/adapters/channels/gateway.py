"""ChannelGateway: routes an OutboundMessage to the right channel transport.

Four channels, each a tiny Protocol. The transports live in simulator/transports.
A pilot swaps the transports for ZiVA (WhatsApp), the SMS aggregator, the USSD
gateway and the in-app push service.
"""

from typing import Protocol

from matchpoint.adapters.errors import DeliveryFailed
from matchpoint.adapters.purpose import Purpose
from matchpoint.clock import Clock
from matchpoint.models import Channel, DeliveryReceipt, OutboundMessage


class ChannelTransport(Protocol):
    def send(self, msg: OutboundMessage, at) -> DeliveryReceipt: ...  # type: ignore[valid-type]


class ChannelGatewayImpl:
    def __init__(self, transports: dict[Channel, ChannelTransport], clock: Clock):
        self._transports = transports
        self._clock = clock

    def send(self, msg: OutboundMessage, *, purpose: Purpose) -> DeliveryReceipt:
        transport = self._transports.get(msg.channel)
        if transport is None:
            raise DeliveryFailed("ChannelGateway", f"no transport for channel {msg.channel}")
        return transport.send(msg, self._clock.now())
