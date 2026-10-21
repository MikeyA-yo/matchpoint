"""Customer phone-view routes: inbox, respond, why, consent, for-you."""

from fastapi import APIRouter

from matchpoint.customer import consent_api, for_you, inbox, responses

router = APIRouter(prefix="/api/v1")

router.include_router(inbox.router)
router.include_router(responses.router)
router.include_router(consent_api.router)
router.include_router(for_you.router)
