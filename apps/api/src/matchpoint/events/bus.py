"""In-process fan-out for the SSE stream: one publisher, many subscribers, no replay.

`publish` is safe to call from a worker thread. The decisions route is a sync `def`, so
starlette runs it off the event loop, and `asyncio.Queue` is not thread-safe. The bus
remembers the loop its subscribers registered on and hands events over with
`call_soon_threadsafe`; a publish that already happens on that loop is delivered directly.

A subscriber that stops reading cannot grow the heap: the queue is bounded and drops the
oldest event when full. Events published with nobody listening are dropped.
"""

from __future__ import annotations

import asyncio

from matchpoint.events.schemas import StreamEvent

QUEUE_SIZE = 1_000

# Sentinel that wakes a subscriber so its response can close cleanly.
CLOSED = object()


class EventBus:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue[object]] = []
        self._loop: asyncio.AbstractEventLoop | None = None

    def subscribe(self) -> asyncio.Queue[object]:
        """Register a subscriber. Must be called from the event loop."""
        self._loop = asyncio.get_running_loop()
        queue: asyncio.Queue[object] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[object]) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def publish(self, event: StreamEvent) -> None:
        """Hand an event to every subscriber, from any thread."""
        if self._loop is None or not self._subscribers:
            return
        if self._on_loop():
            self._offer(event)
        else:
            self._loop.call_soon_threadsafe(self._offer, event)

    def close(self) -> None:
        """End every open stream. The browser's EventSource reconnects by itself."""
        if self._loop is None:
            self._subscribers.clear()
            return
        if self._on_loop():
            self._close_all()
        else:
            self._loop.call_soon_threadsafe(self._close_all)

    def _on_loop(self) -> bool:
        try:
            return asyncio.get_running_loop() is self._loop
        except RuntimeError:
            return False

    def _offer(self, event: StreamEvent) -> None:
        for queue in list(self._subscribers):
            self._put(queue, event)

    def _close_all(self) -> None:
        for queue in list(self._subscribers):
            self._put(queue, CLOSED)
        self._subscribers.clear()

    @staticmethod
    def _put(queue: asyncio.Queue[object], item: object) -> None:
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(item)
