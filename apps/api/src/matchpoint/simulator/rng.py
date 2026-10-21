"""Seeded randomness. Every stream is derived from (seed, keys), never from global state.

Deriving a fresh stream per key means one customer's data does not depend on how many
others were generated first, or in what order. Python guarantees that seeding and
Random.random() are stable across versions; other methods (choice, shuffle, ...) are
stable within one interpreter version, which is what the repeatability test checks.
"""

import hashlib
import random


def derive(seed: int, *keys: object) -> random.Random:
    material = "\x1f".join([str(seed), *(str(k) for k in keys)]).encode()
    digest = hashlib.sha256(material).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))
