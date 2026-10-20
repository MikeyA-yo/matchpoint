from fastapi import APIRouter

from matchpoint.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "env": get_settings().env, "version": "0.1.0"}
