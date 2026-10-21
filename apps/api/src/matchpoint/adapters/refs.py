"""customer_ref: an HMAC of the source system's customer ID, never the ID itself.

The doc's example `cus_8f3a` is illustrative. Four hex characters collide within a few
thousand customers, so refs carry 12 (48 bits).

HMAC is one-way, so a connector that must query the source by its own ID keeps a
RefIndex built by hashing the IDs it is allowed to see.
"""

import hashlib
import hmac
import re

from matchpoint.adapters.errors import CustomerNotFound

REF_HEX = 12
_REF = re.compile(rf"^cus_[0-9a-f]{{{REF_HEX}}}$")
MIN_KEY_BYTES = 16


def is_customer_ref(value: object) -> bool:
    return isinstance(value, str) and bool(_REF.match(value))


class RefHasher:
    def __init__(self, key: bytes, namespace: str = "customer"):
        if len(key) < MIN_KEY_BYTES:
            raise ValueError(f"HMAC key must be at least {MIN_KEY_BYTES} bytes")
        self._key = key
        self._namespace = namespace

    def ref(self, source_id: str) -> str:
        message = f"{self._namespace}:{source_id}".encode()
        mac = hmac.new(self._key, message, hashlib.sha256).hexdigest()
        return f"cus_{mac[:REF_HEX]}"


class RefIndex:
    """customer_ref -> source ID, for the IDs this connector has been given."""

    def __init__(self, hasher: RefHasher, connector: str):
        self._hasher = hasher
        self._connector = connector
        self._by_ref: dict[str, str] = {}

    def add(self, source_id: str) -> str:
        ref = self._hasher.ref(source_id)
        existing = self._by_ref.get(ref)
        if existing is not None and existing != source_id:
            raise ValueError(f"customer_ref collision on {ref}; widen REF_HEX")
        self._by_ref[ref] = source_id
        return ref

    def resolve(self, customer_ref: str) -> str:
        try:
            return self._by_ref[customer_ref]
        except KeyError:
            raise CustomerNotFound(self._connector, f"Unknown customer {customer_ref}") from None

    def __contains__(self, customer_ref: object) -> bool:
        return customer_ref in self._by_ref

    def __len__(self) -> int:
        return len(self._by_ref)

    def refs(self) -> list[str]:
        return sorted(self._by_ref)
