from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from matchpoint.config import get_settings
from matchpoint.errors import install_error_handlers
from matchpoint.routers import health

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="MATCHPOINT API", version="0.1.0", docs_url=f"{API_PREFIX}/docs",
                  openapi_url=f"{API_PREFIX}/openapi.json")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    app.include_router(health.router, prefix=API_PREFIX)
    return app


app = create_app()
