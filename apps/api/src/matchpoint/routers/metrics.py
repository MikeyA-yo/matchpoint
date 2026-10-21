"""Staff metrics: the 30-day overview and the by-channel table.

Both read the in-memory message log the pipeline writes on a live send and the
append-only decision log. Nothing is cached; the demo is small enough to scan per
request. Every response says simulated.

Two numbers are demo assumptions, not measurements: there is no control group and no
60-day use check in the simulator yet.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel

from matchpoint.customer.message_log import CHANNELS, Channel, StoredMessage
from matchpoint.pipeline.schemas import Decision
from matchpoint.wiring import Runtime, get_runtime

router = APIRouter(prefix="/metrics", tags=["metrics"])

WindowDays = Annotated[int, Query(ge=1, le=365)]

CONTROL_GROUP_UPTAKE = 0.022
SUSTAINED_USE_60D = 0.41


class ChannelRow(BaseModel):
    channel: Channel
    sent: int
    click_rate: float
    product_uptake: float


class TotalRow(BaseModel):
    sent: int
    click_rate: float
    product_uptake: float


class OverviewResponse(BaseModel):
    window_days: int
    as_of: datetime
    # The existing console fields.
    sent: int
    held: int
    silent: int
    review: int
    opt_outs: int
    sustained_use_60d: float
    # The results strip.
    notifications_sent: int
    click_rate: float
    product_uptake: float
    control_group_uptake: float
    simulated: bool = True


class ByChannelResponse(BaseModel):
    window_days: int
    channels: list[ChannelRow]
    total: TotalRow
    simulated: bool = True


def _window(
    messages: list[StoredMessage], as_of: datetime, days: int
) -> list[StoredMessage]:
    cutoff = as_of - timedelta(days=days)
    return [message for message in messages if cutoff < message.sent_at <= as_of]


def _live_decisions(runtime: Runtime, as_of: datetime, days: int) -> list[Decision]:
    cutoff = as_of - timedelta(days=days)
    return [
        decision
        for decision in runtime.log.entries()
        if decision.mode == "live" and cutoff < decision.as_of <= as_of
    ]


def _opened(message: StoredMessage) -> bool:
    return message.opened_at is not None


def _accepted(message: StoredMessage) -> bool:
    return message.accepted_at is not None


def _rate(part: int, whole: int) -> float:
    return round(part / whole, 3) if whole else 0.0


def _row(channel: Channel, messages: list[StoredMessage]) -> ChannelRow:
    sent = len(messages)
    return ChannelRow(
        channel=channel,
        sent=sent,
        click_rate=_rate(sum(1 for message in messages if _opened(message)), sent),
        product_uptake=_rate(sum(1 for message in messages if _accepted(message)), sent),
    )


def _grouped(messages: list[StoredMessage]) -> dict[Channel, list[StoredMessage]]:
    grouped: dict[Channel, list[StoredMessage]] = {channel: [] for channel in CHANNELS}
    for message in messages:
        grouped[message.channel].append(message)
    return grouped


@router.get("/overview", response_model=OverviewResponse)
def overview(window_days: WindowDays = 30) -> OverviewResponse:
    runtime = get_runtime()
    as_of = runtime.clock.now()
    messages = _window(runtime.adapters.message_store.all(), as_of, window_days)
    decisions = _live_decisions(runtime, as_of, window_days)

    sent = len(messages)
    return OverviewResponse(
        window_days=window_days,
        as_of=as_of,
        sent=sent,
        held=sum(1 for decision in decisions if decision.outcome == "hold"),
        silent=sum(1 for decision in decisions if decision.outcome == "silent"),
        review=sum(1 for decision in decisions if decision.outcome == "review"),
        opt_outs=len(
            {
                decision.customer_ref
                for decision in decisions
                if "OPTED_OUT" in decision.reasons
            }
        ),
        sustained_use_60d=SUSTAINED_USE_60D,
        notifications_sent=sent,
        click_rate=_rate(sum(1 for message in messages if _opened(message)), sent),
        product_uptake=_rate(
            sum(1 for message in messages if _accepted(message)), sent
        ),
        control_group_uptake=CONTROL_GROUP_UPTAKE,
    )


@router.get("/by-channel", response_model=ByChannelResponse)
def by_channel(window_days: WindowDays = 30) -> ByChannelResponse:
    runtime = get_runtime()
    as_of = runtime.clock.now()
    messages = _window(runtime.adapters.message_store.all(), as_of, window_days)
    grouped = _grouped(messages)

    sent = len(messages)
    return ByChannelResponse(
        window_days=window_days,
        channels=[_row(channel, grouped[channel]) for channel in CHANNELS],
        total=TotalRow(
            sent=sent,
            click_rate=_rate(sum(1 for message in messages if _opened(message)), sent),
            product_uptake=_rate(
                sum(1 for message in messages if _accepted(message)), sent
            ),
        ),
    )
