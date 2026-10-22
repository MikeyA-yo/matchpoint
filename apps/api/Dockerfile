FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.9.2 /uv /usr/local/bin/uv

# lightgbm needs libgomp1 at runtime; hdbscan and sentence-transformers need a
# compiler to install their native wheels on exotic archs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

# Dependencies first, so code changes don't bust the layer cache
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
# Hosts like Render and Railway inject $PORT
CMD ["sh", "-c", "uvicorn matchpoint.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
