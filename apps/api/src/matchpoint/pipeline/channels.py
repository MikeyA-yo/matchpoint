"""Channel choice and quiet-hour scheduling.

Channel consent is per channel, so the first consented channel in the category's order
wins. Promotional SMS is skipped for a number on the NCC DND registry. Quiet hours never
drop a candidate; they move the send to the end of the window.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from matchpoint.models import Channel, Consent, Product
from matchpoint.pipeline.policy import QuietWindow

CHANNEL_ORDER: dict[str, tuple[Channel, ...]] = {
    "business": ("ussd", "app", "whatsapp", "sms", "email"),
    "savings": ("app", "whatsapp", "sms", "email", "ussd"),
    "credit": ("app", "whatsapp", "sms", "email", "ussd"),
    "service": ("app", "whatsapp", "sms", "email", "ussd"),
    "cards": ("app", "whatsapp", "email", "sms", "ussd"),
}
DEFAULT_ORDER: tuple[Channel, ...] = ("app", "whatsapp", "sms", "email", "ussd")


def choose_channel(
    consent: Consent, product: Product, *, sms_allowed: bool = True
) -> Channel | None:
    for channel in CHANNEL_ORDER.get(product.category, DEFAULT_ORDER):
        if channel == "sms" and not sms_allowed:
            continue
        if consent.channels.get(channel, False):
            return channel
    return None


def next_window_end(at: datetime, window: QuietWindow) -> datetime:
    """The first moment at or after `at` when the quiet window is over."""
    end = at.replace(
        hour=window.end.hour, minute=window.end.minute, second=0, microsecond=0
    )
    if end <= at:
        end += timedelta(days=1)
    return end
