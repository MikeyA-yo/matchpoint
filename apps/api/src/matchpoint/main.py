from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import RequestResponseEndpoint

from matchpoint.config import get_settings
from matchpoint.customer import routes as customer_routes
from matchpoint.errors import install_error_handlers
from matchpoint.routers import decisions, health
from matchpoint.trace import current_trace_id, reset_trace_id, set_trace_id

TRACE_HEADER = "X-Trace-Id"

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
        expose_headers=[TRACE_HEADER],
    )

    @app.middleware("http")
    async def _trace(request: Request, call_next: RequestResponseEndpoint) -> Response:
        token = set_trace_id(request.headers.get(TRACE_HEADER))
        try:
            response = await call_next(request)
            response.headers[TRACE_HEADER] = current_trace_id()
            return response
        finally:
            reset_trace_id(token)

    install_error_handlers(app)

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(decisions.router, prefix=API_PREFIX)
    app.include_router(customer_routes.router)
    return app


app = create_app()
