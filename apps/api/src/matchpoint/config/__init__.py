"""Runtime JSON configuration and env-driven Settings.

- `Settings` and `get_settings` are re-exported from this package so existing
  imports (`from matchpoint.config import Settings, get_settings`) keep working.
- The JSON files that live beside this file (narration_anchors.json,
  eligibility_rules.json, compliance_policy.json, cluster_params.json) are
  loaded through `importlib.resources` so they ship inside the wheel.
"""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from typing import Any

from matchpoint.config.settings import Settings, get_settings

__all__ = [
    "Settings",
    "get_settings",
    "load_json",
    "narration_anchors",
    "eligibility_rules",
    "compliance_policy",
    "cluster_params",
]


@lru_cache(maxsize=16)
def load_json(name: str) -> dict[str, Any]:
    """Load `<name>.json` from the config package as a dict. Cached per name."""
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
