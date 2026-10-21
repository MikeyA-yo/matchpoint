"""GET /stream: Server-Sent Events for the demo console (docs/api_design.md 5.5).

One generator per connection, fed by the runtime's event bus. A 15-second keep-alive
comment keeps proxies from closing an idle stream; the browser's EventSource reconnects
by itself after a reset or a dropped connection.
"""

import asyncio
import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from matchpoint import wiring
from matchpoint.events.bus import CLOSED

router = APIRouter(tags=["stream"])

KEEPALIVE_SECONDS = 15.0

HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.get("/stream")
async def stream() -> StreamingResponse:
    bus = wiring.get_runtime().events
    queue = bus.subscribe()

    async def events():
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

    return StreamingResponse(
        events(), media_type="text/event-stream", headers=HEADERS
    )
