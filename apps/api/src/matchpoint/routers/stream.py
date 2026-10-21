"""GET /stream: Server-Sent Events for the demo console (docs/api_design.md 5.6).

One generator per connection, fed by the runtime's event bus. A 15-second keep-alive
comment keeps proxies from closing an idle stream; the browser's EventSource reconnects
by itself after a reset or a dropped connection.
"""

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from matchpoint import wiring
from matchpoint.events.bus import CLOSED, EventBus

router = APIRouter(tags=["stream"])

KEEPALIVE_SECONDS = 15.0

HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


async def event_stream(bus: EventBus, queue: asyncio.Queue[object]) -> AsyncIterator[str]:
    """SSE frames for one subscriber, until the bus closes or the client goes away.

    The queue is subscribed by the route before the response starts, so an event
    published between the first byte and the first read is not lost.
    """
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_SECONDS)
            except TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if event is CLOSED:
                break
            data = json.dumps(event.data, separators=(",", ":"))
            yield f"event: {event.type}\ndata: {data}\n\n"
    finally:
        bus.unsubscribe(queue)


@router.get("/stream")
async def stream() -> StreamingResponse:
    bus = wiring.get_runtime().events
    return StreamingResponse(
        event_stream(bus, bus.subscribe()),
        media_type="text/event-stream",
        headers=HEADERS,
    )
