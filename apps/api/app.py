"""Vercel entrypoint. Vercel may install only the dependencies, not this project, so put
src/ on the path before importing the app."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from matchpoint.main import app  # noqa: E402

__all__ = ["app"]
