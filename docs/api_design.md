# MATCHPOINT API (implemented contract)

Status: v0.3, generated from the code in `apps/api/src/matchpoint`. Last verified 2026-10-21 against 42 passing backend tests. Anything that is designed but not built is in [section 8](#8-not-built-design-backlog); it is not part of the running API.

MATCHPOINT is a decision layer that sits between a bank's product teams and its customers. It decides what to recommend, when, on which channel, and whether to say nothing. Transactions, products, profiles, consent and channels are reached through adapters. In this build every adapter is simulator-backed.

Base URL: `/api/v1`. OpenAPI: `/api/v1/docs`.

## 1. Services and adapters

| Module | Responsibility |
|---|---|
| `simulator/` | Simulated clock, seven hand-made demo customers, transaction generator, pattern injection |
| `adapters/` | `TransactionFeed`, `ProductCatalogue`, `CustomerProfile`, `ConsentStore`, `ChannelGateway`, `RewardsFulfilment` |
| `pipeline/` | Detector, matcher, restraint rules, governor, message composer, guardrail, delivery |
| `ledger/` | Append-only decision log |
| `customer/` | Inbox, message responses, Why, consent, For-you |
| `rewards/` | Earn rules, points ledger, tiers, redemption, catalogue |
| `events/` | In-process event bus behind the SSE stream |
| `routers/` | Health, decisions, metrics, simulator control, stream |

### Adapter interfaces

```python
Purpose = Literal["profiling", "marketing", "service"]

class TransactionFeed(Protocol):
    def window(self, customer_ref: str, start: datetime, end: datetime, *, purpose: Purpose) -> list[Txn]: ...

class ProductCatalogue(Protocol):
    def active(self, as_of: datetime, *, purpose: Purpose) -> list[Product]: ...

class CustomerProfile(Protocol):
    def get(self, customer_ref: str, *, purpose: Purpose) -> Profile: ...
    def exists(self, customer_ref: str, *, purpose: Purpose) -> RefExists: ...
    def update_holdings(self, customer_ref: str, holdings: list[str], *, purpose: Purpose) -> Profile: ...

class ConsentStore(Protocol):
    def get(self, customer_ref: str, *, purpose: Purpose) -> Consent: ...
    def set(self, customer_ref: str, consent: Consent, *, purpose: Purpose) -> Consent: ...

class ChannelGateway(Protocol):
    def send(self, msg: OutboundMessage, *, purpose: Purpose) -> DeliveryReceipt: ...

class RewardsFulfilment(Protocol):
    def fulfil(self, redemption: Redemption, *, purpose: Purpose) -> FulfilmentReceipt: ...
```

Services never import a simulator directly; they receive adapters by dependency injection. Every adapter call states its purpose, and `adapters/purpose.py` filters the returned fields.

`adapter_mode` is `sim` in this build. `pilot` raises `NotImplementedError`; a real deployment swaps the transports, not the services.

## 2. Conventions

- Base path `/api/v1`. JSON only. UTF-8.
- Time is ISO 8601 with offset, for example `2026-12-03T09:02:00+01:00`. `as_of` values must be timezone-aware. All times come from the simulated clock; the wall clock is not used.
- Customer references are HMACs: `cus_` followed by exactly 12 lowercase hex characters. The doc's short `cus_8f3a` is illustrative only.
- IDs are derived, not random: decisions and messages hash `(customer_ref, product_id, as_of, mode, epoch)` to 6 hex characters (`dec_`, `msg_`). Repeating a request in the same epoch returns the same record.
- Roles: the only enforced role is on `POST /rewards/events`, which requires `X-Role: system`. Every other endpoint ignores `X-Role`. There is no authentication, no token, and no `/auth` endpoint.
- Every response that carries simulated data includes `"simulated": true`. Exceptions: `/health` and the raw consent/rewards writes.
- Errors use one envelope:
  ```json
  { "error": { "code": "CUSTOMER_NOT_FOUND", "message": "CustomerProfile: unknown cus_...", "trace_id": "trc_41c2" } }
  ```
  Validation failures return `422 VALIDATION_ERROR`. Unknown routes return `404 NOT_FOUND`. The response carries `X-Trace-Id`; an inbound `X-Trace-Id` is reused.
- Lists are not paginated. There is no `limit`, `cursor`, or `{items, next_cursor}` wrapper anywhere yet. `GET /customers/{ref}/inbox` returns `{ "messages": [...] }`.
- Consent, decisions, and reward entries are append-only in memory. `/sim/start` and `/sim/reset` rebuild the runtime and therefore clear them.

Reason codes are in section 3. The decision `mode` and `outcome` include `shown`, used only by For-you.

## 3. Reason codes

| Code | Meaning | Effect |
|---|---|---|
| `OK` | Passed every check | send |
| `NO_CONSENT` | No personalised-offers consent | silent, nothing else is read |
| `OPTED_OUT` | Customer stopped offers, or has an open complaint | silent |
| `NO_CHANNEL_CONSENT` | No consent for any usable channel | hold |
| `SENSITIVE_TRIGGER` | Trigger came from a blocked category | hold |
| `NOT_ELIGIBLE` | Fails the product's eligibility rule | candidate dropped |
| `ALREADY_HOLDS` | Customer already uses the product | candidate dropped |
| `NO_MATCH` | No suitable product, or no trigger | silent |
| `CAP_30D` | Message cap reached in the last 30 days | hold |
| `SAME_PRODUCT_60D` | Same product promoted within the gap | hold |
| `COOLDOWN_IGNORED` | Recently ignored or declined an offer | hold |
| `QUIET_HOURS` | Outside the allowed send window | reschedule, not drop |
| `LOW_UPLIFT` | Predicted benefit below threshold | hold |
| `ATTENTION_BUDGET` | Customer's attention budget is spent | hold |
| `GOVERNOR_LOST` | Another product won the slot | hold |
| `CREDIT_REVIEW` | Credit product, needs a person | review |
| `GUARDRAIL_BLOCKED` | Explainer output failed the safety check | hold |

### Rewards reason codes

| Code | HTTP | Meaning |
|---|---|---|
| `REWARD_INELIGIBLE` | 400 | Event type is not in the earn rules |
| `REWARD_DUPLICATE` | 400 | The idempotency key has already been awarded |
| `REWARD_NO_CONSENT` | 400 | The event needs consent that is not on file |
| `REWARD_CAP_REACHED` | 400 | Per-event or 30-day points cap reached |
| `INSUFFICIENT_POINTS` | 402 | Balance too low to redeem |
| `REWARD_NOT_FOUND` | 404 | Reward item is not in the catalogue |
| `FULFILMENT_FAILED` | 503 | Fulfilment raised; the spend was reversed |
| `ROLE_REQUIRED` | 403 | `POST /rewards/events` was called without `X-Role: system` |

There is no stock check, so `REWARD_OUT_OF_STOCK` does not exist in this build.

## 4. Core data shapes

### Consent

`GET` and successful `PUT` on `/customers/{ref}/consent` return:

```json
{
  "customer_ref": "cus_8f3a12b4c6d8",
  "personalised_offers": true,
  "channels": { "app": true, "whatsapp": true, "sms": false, "email": false, "ussd": false },
  "updated_at": "2026-11-20T18:41:00+01:00"
}
```

`source` is stored on the consent record (`signup`, `api`, `stop_offers`, ...) but is not returned by the HTTP endpoint. Silence is not consent: anything missing reads as `False`.

### Decision

```json
{
  "id": "dec_a91c2f",
  "customer_ref": "cus_8f3a12b4c6d8",
  "as_of": "2026-12-03T09:02:00+01:00",
  "mode": "live",
  "outcome": "send",
  "product_id": "prd_target_savings",
  "channel": "app",
  "reasons": ["OK"],
  "scheduled_for": null,
  "trace": {
    "triggers": [{ "type": "salary_regular", "evidence": "salary on the 25th, 4 months", "category": null, "blocked": false }],
    "candidates": [{ "product_id": "prd_target_savings", "eligible": true, "uplift": 0.071, "dropped": null }],
    "rules": [{ "rule": "CAP_30D", "passed": true, "detail": "0 of 2 used" }],
    "steps": [{ "step": 1, "name": "consent_gate", "status": "ok", "reason": "OK", "detail": "Consent from simulator" }],
    "policy_version": "pol_v3",
    "model_version": "rules_v1"
  },
  "message": {
    "title": "School fees are coming up",
    "body": "You have paid school fees each January and September...",
    "why": "Based on your salary and school fee payments. You allowed personalised offers."
  },
  "epoch": 0,
  "simulated": true
}
```

- `mode` is `live`, `dry_run`, or `shown`.
- `outcome` is `send`, `hold`, `silent`, `review`, or `shown`.
- A `send` that falls in quiet hours keeps `outcome: "send"`, adds `QUIET_HOURS` to `reasons`, and sets `scheduled_for`; the gateway is not called until that time.
- A credit product becomes `outcome: "review"` with `CREDIT_REVIEW`.

### Inbox message

```json
{
  "id": "msg_ab12cd",
  "sent_at": "2026-12-03T09:02:00+01:00",
  "channel": "app",
  "product_id": "prd_target_savings",
  "title": "School fees are coming up",
  "body": "You have paid school fees each January and September...",
  "status": "sent",
  "response": null
}
```

`status` is `sent`, `opened`, `accepted`, or `not_now`. `response` is one of `opened`, `accepted`, `not_now`, `stop_offers`, or `null`.

### Rewards

Reward account (`GET /customers/{ref}/rewards`):

```json
{
  "customer_ref": "cus_8f3a12b4c6d8",
  "balance": 170,
  "lifetime_earned": 170,
  "tier": "Base",
  "next_tier": { "name": "Silver", "points_needed": 30 }
}
```

There is no `ways_to_earn` list and no `simulated` flag on this response. `lifetime_earned` is the current balance, not a separate lifetime total.

Catalogue item (`GET /rewards/catalogue`):

```json
{ "id": "rwi_airtime_500", "name": "Airtime ₦500", "points": 100, "kind": "airtime" }
```

Catalogue in this build:

| id | name | points | kind |
|---|---|---|---|
| `rwi_airtime_500` | Airtime ₦500 | 100 | airtime |
| `rwi_fee_waiver` | Transfer fee waiver | 150 | fee_waiver |
| `rwi_voucher_1000` | ₦1,000 voucher | 300 | voucher |

Fulfilment receipt (inside a redemption response):

```json
{ "redemption_id": "…", "status": "fulfilled", "at": "2026-11-20T18:41:00+01:00", "provider_ref": "airtime:…", "reason": null }
```

## 5. Endpoints

### 5.1 System

#### `GET /health`

```json
{ "status": "ok", "env": "local", "version": "0.1.0" }
```

`env` comes from `MATCHPOINT_ENV` (default `local`).

### 5.2 Decisions

#### `POST /decisions/evaluate`

```json
{ "customer_ref": "cus_8f3a12b4c6d8", "as_of": "2026-12-03T09:02:00+01:00", "mode": "live" }
```

- `as_of` is optional; it defaults to the simulated clock.
- `mode` defaults to `live`. `dry_run` records a decision without delivering. `shown` is used by For-you.
- Response: a Decision (section 4).
- The pipeline is skipped if a decision with the same derived ID already exists in the current epoch; the stored decision is returned.
- `POST /sim/inject` bumps the customer's epoch, so their next evaluation is fresh.

Errors: `404 CUSTOMER_NOT_FOUND`, `422 VALIDATION_ERROR`.

There is no `SIM_NOT_STARTED` check on this endpoint; the simulated clock has a default start.

### 5.3 Customer surface (phone view)

#### `GET /customers/{ref}/consent`

Returns the Consent shape (section 4). An unknown ref gets a default consent record from the simulator transport rather than a 404.

#### `PUT /customers/{ref}/consent`

```json
{ "personalised_offers": true, "channels": { "app": true, "whatsapp": false, "sms": false, "ussd": false } }
```

- Appends to the consent ledger, updates the store, sets `source: "api"`.
- Only `app`, `whatsapp`, `sms`, and `ussd` are read from the body; `email` is always stored as `false`.
- First transition of `personalised_offers` from `false` to `true` calls the earn handler for `consent_granted` (50 points, once per purpose).
- Does **not** invalidate cached decisions. A repeat evaluation at the same `as_of` and `mode` returns the earlier decision.

#### `GET /customers/{ref}/inbox`

```json
{
  "messages": [
    {
      "id": "msg_ab12cd",
      "sent_at": "2026-12-03T09:02:00+01:00",
      "channel": "app",
      "product_id": "prd_target_savings",
      "title": "School fees are coming up",
      "body": "You have paid school fees each January and September...",
      "status": "sent",
      "response": null
    }
  ]
}
```

Newest first. Only messages actually delivered in `live` mode are stored.

#### `GET /messages/{id}/why`

```json
{
  "message_id": "msg_ab12cd",
  "reason": "Based on your salary and school fee payments. You allowed personalised offers.",
  "data_used": [
    { "kind": "transactions, 6 months", "source": "core banking", "permission": "marketing consent" }
  ],
  "consent_url": "/customers/cus_8f3a12b4c6d8/consent"
}
```

`consent_url` is a path, not an absolute URL. Missing message: `404 NOT_FOUND`.

#### `POST /messages/{id}/respond`

```json
{ "action": "not_now" }
```

`action` is `opened`, `accepted`, `not_now`, or `stop_offers`.

| Action | Response | Side effects |
|---|---|---|
| `opened` | `{ "status": "opened" }` | Marks the message opened |
| `accepted` | `{ "status": "accepted" }` | Marks it accepted and adds the product to the simulated holdings |
| `not_now` | `{ "status": "not_now" }` | Records a cooldown for that product and attempts an `offer_feedback` earn (5 points, capped at 2 per 30 days) |
| `stop_offers` | Consent object | Sets `personalised_offers: false` and all channels `false`, `source: "stop_offers"`; does not revoke earned points |

`stop_offers` does not emit a stream event or invalidate cached decisions in this build.

Errors: `404 NOT_FOUND`, `422 VALIDATION_ERROR`.

#### `GET /customers/{ref}/for-you`

Returns up to three non-credit catalogue items plus an optional loan prompt. This is the customer-facing discovery list, not a delivered message.

```json
{
  "personalised": true,
  "items": [
    {
      "rank": 1,
      "product_id": "prd_target_savings",
      "name": "Target savings account",
      "why": "Based on salary_regular, fee_season. You allowed personalised offers.",
      "gain": { "amount_ngn": 42000, "period_months": 12, "basis": "An illustrative 5% a year.", "example_rate": true },
      "key_facts": ["Set a goal", "Automatic monthly transfer"],
      "compare": [{ "product_id": "prd_fixed_savings", "when_it_fits": "When you have a large amount." }]
    }
  ],
  "note": null,
  "simulated": true
}
```

- Without personalised offers: returns up to three non-credit catalogue products with `why: "General catalogue product."`, `personalised: false`.
- With consent: runs detection and matching, keeps eligible non-credit products with a positive score, sorts by score, takes three.
- If fewer than three products match, appends `prd_talk_loans` ("Talk to us about loans"). `note` explains that fewer products fit.
- Writes a decision with `mode: "shown"`, `outcome: "shown"`. Shown decisions do not count toward the 30-day cap and are not delivered.

### 5.4 Rewards

#### `GET /customers/{ref}/rewards`

Returns the account shape (section 4). No profile or transaction data is read; an unknown ref simply has a zero balance. Does not include a test/simulated flag.

#### `POST /customers/{ref}/rewards/redeem`

```json
{ "reward_id": "rwi_airtime_500" }
```

Requires an `Idempotency-Key` header. Missing header: `422 VALIDATION_ERROR`.

1. Look up the catalogue item (`404 REWARD_NOT_FOUND`).
2. Check the balance (`402 INSUFFICIENT_POINTS`).
3. Append a `spend` entry.
4. Call the fulfilment adapter. On failure, append a `reversal` and return `503 FULFILMENT_FAILED`.
5. Emit `points_redeemed`.

Success:

```json
{
  "customer_ref": "cus_8f3a12b4c6d8",
  "balance": 70,
  "receipt": { "redemption_id": "…", "status": "fulfilled", "at": "2026-11-20T18:41:00+01:00", "provider_ref": "airtime:…", "reason": null }
}
```

#### `GET /rewards/catalogue`

```json
{ "catalogue": [{ "id": "rwi_airtime_500", "name": "Airtime ₦500", "points": 100, "kind": "airtime" }], "simulated": true }
```

#### `POST /rewards/events`

Internal earn endpoint. Requires `X-Role: system`; otherwise `403 ROLE_REQUIRED`.

```json
{ "customer_ref": "cus_8f3a12b4c6d8", "event": "consent_granted", "purpose": "personalised_offers", "as_of": "2026-11-20T18:41:00+01:00" }
```

Optional fields: `purpose`, `product`, `as_of`.

Earn rules in this build:

| Event | Points | Cap |
|---|---|---|
| `consent_granted` | 50 | Once per purpose |
| `preferences_reviewed` | 20 | Once per year; requires consent |
| `offer_feedback` | 5 | Twice per 30 days; requires consent |
| `product_use_milestone` | 100 | Once per product, after 60 days; not yet called by the outcome tracker |

Global cap: 150 points per 30 days. Idempotency key is `customer_ref|event|purpose:…|product:…`, so retries and toggling consent do not double-award. No expiry job runs.

Success:

```json
{ "customer_ref": "cus_8f3a12b4c6d8", "event": "consent_granted", "points": 50, "tier_changed": false, "tier": "Base" }
```

Errors: `400` with one of the rewards reason codes, `403 ROLE_REQUIRED`, `422 VALIDATION_ERROR`.

Events published: `points_awarded`, plus `tier_changed` when the balance crosses 200 or 600 points. Redeeming publishes `points_redeemed`.

### 5.5 Console metrics

#### `GET /metrics/overview?window_days=30`

```json
{
  "window_days": 30,
  "as_of": "2026-12-03T09:02:00+01:00",
  "sent": 128,
  "held": 54,
  "silent": 31,
  "review": 2,
  "opt_outs": 4,
  "sustained_use_60d": 0.41,
  "notifications_sent": 128,
  "click_rate": 0.32,
  "product_uptake": 0.11,
  "control_group_uptake": 0.022,
  "simulated": true
}
```

`window_days` must be 1-365 (default 30). `sustained_use_60d` (0.41), `control_group_uptake` (0.022), and `click_rate`/`product_uptake` are demo assumptions or simple ratios over the in-memory message log, not measured causal effects. `held`, `silent`, and `review` come from `live` decisions only. Empty log means zeros.

#### `GET /metrics/by-channel?window_days=30`

```json
{
  "window_days": 30,
  "channels": [
    { "channel": "app", "sent": 40, "click_rate": 0.35, "product_uptake": 0.12 },
    { "channel": "whatsapp", "sent": 30, "click_rate": 0.3, "product_uptake": 0.1 },
    { "channel": "sms", "sent": 20, "click_rate": 0.2, "product_uptake": 0.05 },
    { "channel": "email", "sent": 0, "click_rate": 0.0, "product_uptake": 0.0 },
    { "channel": "ussd", "sent": 0, "click_rate": 0.0, "product_uptake": 0.0 }
  ],
  "total": { "sent": 90, "click_rate": 0.3, "product_uptake": 0.1 },
  "simulated": true
}
```

There is no `/metrics/by-product`; the frontend still calls that path.

### 5.6 Demo control and stream

#### `POST /sim/start`

```json
{ "seed": 42, "n_customers": 5000, "days": 120, "scenario": "baseline" }
```

All fields are optional with those defaults. Rebuilds the runtime (new decision log, consent store, message store, rewards ledger), starts the clock at `2026-12-03T09:00:00+01:00`, and clears injected patterns. Returns the sim state.

`n_customers` is accepted and echoed, but the generator behind it is still seven hand-made demo customers; `simulated_customers` reports the real number.

#### `POST /sim/reset`

Rebuilds the runtime and returns the stopped sim state. All decisions, messages, consent changes, and reward points are gone. Seed returns to the default.

#### `POST /sim/inject`

```json
{ "pattern": "salary_pattern", "customer_ref": "cus_8f3a12b4c6d8" }
```

`pattern` is `salary_pattern`, `fee_season`, or `sme_growth`. `customer_ref` is optional.

- With a customer: plants rows in that customer's simulator transactions and bumps their epoch so the next evaluation is not cached.
- Without a customer: records the event and reports `affected = round(n_customers * 0.05)`; it does **not** plant rows across the population.
- Requires a running simulator: `409 SIM_NOT_STARTED`. Unknown customer: `404 CUSTOMER_NOT_FOUND`.

Response: `{ "pattern": "salary_pattern", "customer_ref": "cus_…", "affected": 1 }`.

#### `GET /sim/state`

```json
{
  "seed": 42,
  "n_customers": 5000,
  "days": 120,
  "scenario": "baseline",
  "running": true,
  "clock": "2026-12-03T09:00:00+01:00",
  "simulated": true,
  "simulated_customers": 7,
  "injected": [
    { "pattern": "fee_season", "customer_ref": "cus_…", "affected": 1, "at": "2026-12-03T09:00:00+01:00" }
  ]
}
```

The last ten injections are kept. `clock` is `null` when the simulator is not running.

#### `GET /stream`

Server-Sent Events. No replay: events published with nobody listening are dropped. A 15-second keep-alive comment keeps proxies open. `/sim/start` and `/sim/reset` close existing streams; `EventSource` reconnects itself.

Frames:

```
event: decision_created
data: {"at":"2026-12-03T09:02:00+01:00","customer_ref":"cus_…","decision_id":"dec_…","outcome":"send","product_id":"prd_…","channel":"app","reasons":["OK"],"mode":"live"}
```

| Event | When | Payload |
|---|---|---|
| `decision_created` | A new decision is recorded | `at`, `customer_ref`, `decision_id`, `outcome`, `product_id`, `channel`, `reasons`, `mode` |
| `message_delivered` | The gateway accepts a live message | `at`, `customer_ref`, `message_id`, `decision_id`, `product_id`, `channel`, `status` |
| `outcome_recorded` | Defined but not published yet | — |
| `consent_changed` | Defined but not published yet | — |
| `policy_changed` | Defined but not published yet | — |
| `points_awarded` | An earn event is accepted | `at`, `customer_ref`, `event`, `points`, `balance`, `tier` |
| `points_redeemed` | A redemption is fulfilled | `at`, `customer_ref`, `reward_id`, `points`, `balance` |
| `tier_changed` | A balance crosses a tier threshold | `at`, `customer_ref`, `from_tier`, `to_tier` |

The web app handles all eight types.

## 6. What `POST /decisions/evaluate` does

Before the pipeline, the profile adapter is asked only whether the ref exists. An unknown ref gets `404 CUSTOMER_NOT_FOUND` before any profile data is read. The ten traced steps then run in order; the first step that does not proceed ends the run.

1. **Consent gate.** Read consent and nothing else. No personalised offers: `outcome: silent`, reason `NO_CONSENT`.
2. **Opt-out and complaint.** `source == "stop_offers"` or an open complaint: `outcome: silent`, reason `OPTED_OUT`.
3. **Load context.** Profile, 365 days of transactions, active catalogue.
4. **Detect.** Turn transactions into triggers and screen blocked categories. Only blocked triggers: `outcome: hold`, reason `SENSITIVE_TRIGGER`. No triggers: `outcome: silent`, reason `NO_MATCH`.
5. **Match.** Eligibility and suitability checks (`NOT_ELIGIBLE`, `ALREADY_HOLDS`, `NO_MATCH`).
6. **Hard rules.** Consent for a channel, 30-day cap, same-product gap, cooldown, quiet hours, DND, credit review. Quiet hours reschedule; credit goes to `review`.
7. **Pick one.** Best viable candidate; below `min_uplift` becomes `LOW_UPLIFT`, and a spent attention budget becomes `ATTENTION_BUDGET`. The governor reason `GOVERNOR_LOST` is reserved for the unbuilt batch flow.
8. **Compose.** Fill the approved template from evidence, gain, and key facts.
9. **Guardrail.** Three CBN safety checks; failure clears the message and returns `GUARDRAIL_BLOCKED`.
10. **Deliver.** Choose the channel. `dry_run` stops here. `live` calls the gateway unless the message is scheduled for later.

After the last step, the decision is appended once, then `decision_created` is published, followed by `message_delivered` if the gateway accepted a message. The trace reports these steps as `step` 1-10.

Hard rules always win over the learned rule. The learned rule can only make the system quieter.

For-you does not run this pipeline end to end: it loads consent, profile, transactions and catalogue, then runs detection and matching for all non-credit products, skipping opt-out/complaint, contact rules, composition, guardrail and delivery. It logs an `outcome: "shown"` decision.

## 7. Web app integration status

The web app defaults to its in-browser mock backend. Turning on Developer view and clicking the Mock API pill (or setting `VITE_API_MOCK=false`) switches a browser to this API. In live mode every call goes to the API first and falls back to the mock only when the API has no such route; the console sidebar (Developer view) lists which endpoints were served live.

| Area | API today | Web app in live mode |
|---|---|---|
| Simulator, evaluate, consent, for-you, rewards, metrics, stream | Implemented | Uses the API |
| Inbox | `{ messages }`, `sent_at`, `status: sent/...` | Adapted client-side to `Page<Message>` (`apps/web/src/lib/api.ts`, `adapt`) |
| Why | `{ reason, data_used }` | Adapted to `{ why, data_categories }` |
| Respond | `{ status }` or a consent object, no stream event | Accepted as is; the phone refreshes itself after each action |
| For-you `why` | Names raw signals (`salary_regular`) | Reworded on the phone; the API should return plain text |
| Consent `email` | Always stored `false` | Email toggle removed from the phone and sign-up |
| Auth, `GET /customers/{ref}` | Not implemented | Mock. Sign-in lists the seven demo customers with their API refs. Customers created by sign-up exist only in the mock, so all their calls go to the mock |
| `GET /decisions`, review approve/reject | Not implemented | Mock. Live `evaluate` results are copied into the mock store so the decision log, review queue and message log show them. Approving there does not reach the API, so an approved credit offer never lands in the live inbox |
| `GET /metrics/by-product` | Not implemented | No longer used; the overview shows by-channel |
| Policies, products, campaigns, audit, experiments, model | Not implemented | Mock |
| Stream | Eight event types | All eight handled, including `points_awarded`, `tier_changed`, `points_redeemed` |

Asks for the API, in demo order:

1. `POST /decisions/{id}/approve` and `/reject`, so the credit-review story works live.
2. `GET /decisions` (filters `customer_ref`, `outcome`), so the console stops relying on copied decisions.
3. Invalidate cached decisions when consent changes. Today, after Stop offers, re-running at the same `as_of` returns the earlier `send`.
4. Plain-language `why` on for-you items.

## 8. Not built (design backlog)

These appear in earlier drafts and in the frontend contract, but no route serves them. They are listed so the gap is explicit.

| Area | Missing endpoints / behaviour |
|---|---|
| Auth and customer profile | `POST /auth/signup`, `POST /auth/signin`, `GET /customers/{ref}` |
| Decision history and review | `POST /decisions/batch`, `GET /decisions`, `GET /decisions/{id}`, approve/reject, persisted filtering/segments |
| Governor | Batch arbitration and `GOVERNOR_LOST` |
| Policy service | Versioned policy store, `GET/PUT /policies`, approve, simulate; the running policy is `DEFAULT_POLICY` (`pol_v3`) |
| Catalogue service | `GET/POST /products`, `PUT /products/{id}`; the catalogue is read-only simulator data |
| Campaign requests | `POST /campaign-requests`, `GET /campaign-requests/{id}` |
| Audit | `GET /audit/log`, `GET /audit/export` |
| Experiments | `POST /experiments/run`, `GET /experiments/{id}`; the three-strategy protocol and consent-incentive experiment are design only |
| Model | `POST /model/train`, `GET /model/info`; the trace reports `model_version: "rules_v1"` |
| Product metrics | `GET /metrics/by-product` |
| Rewards history | `GET /customers/{ref}/rewards/history` |
| Rewards rules console | `GET/PUT /rewards/rules`, approve, simulate |
| Rewards metrics | `GET /metrics/rewards` (consent rate, liability, tier distribution) |
| Rewards adjustments | `POST /rewards/adjustments` |
| Reward expiry and stock | No expiry job, no stock check, no reward notifications |
| Clock control | No `/sim/advance`; callers can pass `as_of` to `evaluate`, but quiet-hours scheduled sends never fire automatically |
| Outcome tracker | 30/60-day use checks and `product_use_milestone` emission |
| Consent events | `consent_changed` and `policy_changed` are defined but never published |

The experiment protocol and build order from v0.2 remain in git history.

## 9. Demo checklist (current)

| Check | Status |
|---|---|
| `POST /sim/start` and `/sim/reset` work and repeat with the same seed | Yes |
| `evaluate` returns send, hold, silent, and review with reasons and a trace | Yes |
| Phone view works end to end | Yes for the seven demo customers (inbox, Why, responses, For you, rewards); sign-in and profile still come from the web mock |
| Silence feed in the console | Partly: shows live decisions copied by the web app; no decision-list endpoint |
| Three-strategy experiment | No |
| Every console number labelled simulated | Metrics yes; other console pages are mock-only |
| First consent grant awards points once; toggling does not re-award | Yes |
| Redeeming points writes to the ledger and updates the balance | Yes |
| Withdrawing consent stops earning and keeps points | Yes (no clawback) |
| Console shows consent rate, points issued, points redeemed | No; `/metrics/rewards` is not built |

## 10. Compliance notes that shape the API

- Nigerian data protection rules require consent for direct marketing, including profiling, and silence is not consent. The consent gate runs before anything else.
- CBN consumer protection rules require an opt-out in unsolicited advertisements. Every message carries `stop_offers`.
- Promotional SMS is reported to be allowed only between 08:00 and 20:00 WAT, and the NCC Do Not Disturb registry applies. The SMS quiet-hours default above reflects that. Verify against NCC directives before the pitch.
- Credit products always go to a person. Automated offers of credit can have real consequences for customers.
- No real customer data. Customer references are keyed hashes.
- Consent must be freely given, specific, and informed. An incentive for consent raises a real question about whether it is freely given, which is why rewards never gate service, consent stays optional, and withdrawal is penalty-free. Zenith's legal and data protection teams must review this design before any pilot.
- Reward points are not a credit score and must not be presented or used as one.

## 11. Open items to verify

- NCC promotional SMS window and Do Not Disturb handling, from the directive itself.
- Whether in-app and WhatsApp messages need separate consent wording under Zenith's policy.
- Real Zenith product names, eligibility rules, and which products count as credit.
- Facilitator answers: hosted LLM allowed or local only, work after 4 PM, pre-written code and downloaded models.
- Legal view on incentivised consent under Nigerian data protection rules.
- Whether points create an accounting liability for Zenith, and how Zenith would value them.
- Whether reward notifications count as service or promotional messages, and whether fee-waiver rewards are allowed under CBN rules.
- The final name for the points scheme. Avoid anything that sounds like a credit score.
