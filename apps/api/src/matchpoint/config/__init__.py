"""Runtime JSON configuration. Loaded through importlib.resources so the files
ship inside the wheel. Each loader is cached; tests monkeypatch `_cache` to
substitute per-file."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from typing import Any


@lru_cache(maxsize=16)
def load_json(name: str) -> dict[str, Any]:
    """Load `<name>.json` from the config package as a dict."""
    text = resources.files(__package__).joinpath(f"{name}.json").read_text("utf-8")
    return json.loads(text)


def narration_anchors() -> dict[str, Any]:
    return load_json("narration_anchors")


def eligibility_rules() -> dict[str, Any]:
    return load_json("eligibility_rules")


def compliance_policy() -> dict[str, Any]:
    return load_json("compliance_policy")


def cluster_params() -> dict[str, Any]:
    return load_json("cluster_params")
