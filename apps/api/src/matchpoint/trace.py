"""One trace ID per request, shared by the error envelope and the adapter access log."""

import re
import secrets
from contextvars import ContextVar, Token

_trace_id: ContextVar[str | None] = ContextVar("trace_id", default=None)
_SAFE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def new_trace_id() -> str:
    return f"trc_{secrets.token_hex(4)}"


def current_trace_id() -> str:
    """The active trace ID. Outside a request (scripts, tests) one is created on first use."""
    tid = _trace_id.get()
    if tid is None:
        tid = new_trace_id()
        _trace_id.set(tid)
    return tid


def set_trace_id(candidate: str | None = None) -> Token[str | None]:
    """Use the caller's ID if it is safe to log, otherwise mint one."""
    tid = candidate if candidate and _SAFE.match(candidate) else new_trace_id()
    return _trace_id.set(tid)


def reset_trace_id(token: Token[str | None]) -> None:
    _trace_id.reset(token)
