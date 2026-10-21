# MATCHPOINT

Decision layer that decides what to recommend, when, on which channel, and whether to say nothing. Design: [docs/api_design.md](docs/api_design.md).

## Layout

```
apps/
  api/   FastAPI backend (Python 3.12+, uv). Base path /api/v1
    src/matchpoint/
      adapters/    TransactionFeed, ProductCatalogue, CustomerProfile, ConsentStore, ChannelGateway
      simulator/   simulated clock, synthetic customers, transaction generator
      pipeline/    features, detector, matcher, restraint, governor, explainer, delivery
      ledger/      append-only consent ledger and decision log
      routers/     HTTP endpoints, one module per area (decisions, customers, sim, ...)
  web/   Vite + React + TypeScript: phone view (/) and Zenith console (/console)
docs/    design docs
render.yaml   deploys both apps
```

## Prerequisites

Node 24+, pnpm 10, Python 3.12+, [uv](https://docs.astral.sh/uv/).

## Local development

```sh
pnpm bootstrap  # installs JS and Python deps
pnpm dev        # API on :8000, web on :5173 (web proxies /api to the API)
```

Run one side only with `pnpm dev:api` or `pnpm dev:web`. API docs: http://localhost:8000/api/v1/docs

```sh
pnpm test       # pytest + web typecheck
pnpm lint       # ruff
```

## Frontend

| Route | What it is |
|---|---|
| `/` | Landing page |
| `/signin`, `/signup` | Demo accounts (`POST /auth/*`). Sign-in page has one-click demo customers |
| `/app` | Customer page: phone view (inbox, Why, Not now, Stop offers, privacy settings) plus a demo panel to run decisions, inject patterns and watch events for that customer |
| `/console/*` | Bank console: metrics, silence feed, review queue, run/batch, policies, products, campaign requests, experiments, model, simulator, live events, audit. Role switcher sends `X-Role` |

Each card shows the endpoint(s) it calls. The contract lives in [apps/web/src/lib/types.ts](apps/web/src/lib/types.ts) and [section 5.5 of the design doc](docs/api_design.md).

**Mock vs live data.** The web app ships an in-browser mock backend ([apps/web/src/lib/mock.ts](apps/web/src/lib/mock.ts)) that follows the same contract, uses the API's seven demo customers and product catalogue, and runs a simplified pipeline. In **Live API** mode every call goes to the API first and falls back to the mock only when the API has no such route yet, so endpoints switch over by themselves as they land. With Technical details on, the console sidebar lists which endpoints were live and which were mocked. The pill in the header (shown with Technical details on) switches per browser; `VITE_API_MOCK=false` changes the default. Mock state is shared across tabs, so open the phone and the console side by side. `POST /sim/reset` in the console clears it.

## Deploying

Both apps deploy to [Render](https://render.com) from this repo using [render.yaml](render.yaml):

1. Push to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repo. It creates `matchpoint-api` (Docker) and `matchpoint-web` (static site).
3. Set the two env vars it asks for:
   - `matchpoint-api` → `CORS_ORIGINS` = the web URL (e.g. `https://matchpoint-web.onrender.com`)
   - `matchpoint-web` → `VITE_API_URL` = the API URL (e.g. `https://matchpoint-api.onrender.com`), then redeploy the web service, since Vite bakes it in at build time.

After that, pushes to `main` redeploy only the app whose files changed.

Notes:
- The free API instance sleeps after ~15 minutes idle and takes about a minute to wake. Hit `/api/v1/health` before a demo. In-memory simulator state is lost on sleep, so run `POST /sim/start` again.
- The API is a plain Docker image ([apps/api/Dockerfile](apps/api/Dockerfile), honours `$PORT`), so it also runs on Railway, Fly.io or Cloud Run. The web app is a static `dist/` folder that Vercel or Netlify can serve. Those hosts need an SPA rewrite to `index.html`.
