# MATCHPOINT API guideline (hackathon build)
 
Status: draft v0.2 for the sprint (adds the rewards module in section 5.5). Owner: backend (Olaiwon), ML and explainer (Ayomide), catalogue, policies and copy (Abdulhaqeem).
 
MATCHPOINT is a decision layer that sits between a bank's product teams and its customers. It decides what to recommend, when, on which channel, and whether to say nothing. Everything outside the decision layer (transactions, products, profiles, consent, channels) is reached through adapters. In the hackathon those adapters are simulators. In a pilot they are replaced by connectors to Zenith's systems, with no change to the services or endpoints below.
 
## 1. Services and adapters
 
| Service | Responsibility |
|---|---|
| Simulator | Simulated clock, synthetic customers with planted ground-truth responses, transaction generator |
| Adapters | `TransactionFeed`, `ProductCatalogue`, `CustomerProfile`, `ConsentStore`, `ChannelGateway`, `RewardsFulfilment`. Simulated now, real in a pilot |
| Feature store | Per-customer features from transactions: salary regularity, seasonal payments, inflow growth |
| Detector | Turns features into triggers, then screens them against blocked categories |
| Matcher | Finds eligible, suitable, not-already-held products |
| Restraint engine | Hard rules (consent, caps, gaps, cooldowns, quiet hours) plus the uplift score and attention budget |
| Governor | Arbitrates competing product requests so each customer gets at most one slot |
| Explainer | Writes the message and the reason, from evidence only, behind a sensitive-content guardrail |
| Delivery planner | Chooses the channel from consent, schedules outside quiet hours, hands off to the gateway |
| Consent ledger and decision log | Append-only records. Never edited or deleted |
| Outcome tracker | Records responses and checks real use at 30 and 60 days |
| Policy and catalogue service | Versioned rules with an approval step |
| Experiment runner | Runs several strategies on the same population and compares them |
| Rewards service | Earn rules, points ledger, tiers, redemption. Awards points for consent and engagement events. Never feeds credit decisions |
 
### Adapter interfaces
 
```python
Purpose = Literal["profiling", "marketing", "service"]

class TransactionFeed(Protocol):
    def window(self, customer_ref: str, start: datetime, end: datetime, *, purpose: Purpose) -> list[Txn]: ...
 
class ProductCatalogue(Protocol):
    def active(self, as_of: datetime, *, purpose: Purpose) -> list[Product]: ...
 
class CustomerProfile(Protocol):
    def get(self, customer_ref: str, *, purpose: Purpose) -> Profile: ...      # age band, segment, products held
 
class ConsentStore(Protocol):
    def get(self, customer_ref: str, *, purpose: Purpose) -> Consent: ...
    def set(self, customer_ref: str, consent: Consent, *, purpose: Purpose) -> Consent: ...
 
class ChannelGateway(Protocol):
    def send(self, msg: OutboundMessage, *, purpose: Purpose) -> DeliveryReceipt: ...
 
class RewardsFulfilment(Protocol):
    def fulfil(self, redemption: Redemption, *, purpose: Purpose) -> FulfilmentReceipt: ...   # airtime, voucher, fee waiver
```
 
Rule: services never import a simulator directly. They receive adapters by dependency injection, so a pilot swaps the implementation, not the code. A lint test enforces this.

Every adapter call states its purpose. A wrapper returns only the fields allowed for that purpose (for example, `marketing` sees a transaction's amount band but not its amount or narration) and logs the purpose, the fields returned and the trace ID. The field policy is in `apps/api/src/matchpoint/adapters/purpose.py`.

Connector faults surface as defined errors in the envelope: `503 UPSTREAM_UNAVAILABLE`, `504 UPSTREAM_TIMEOUT`, `502 UPSTREAM_BAD_DATA`, `502 DELIVERY_FAILED`.
 
## 2. Conventions
 
- Base path: `/api/v1`. JSON only. UTF-8.
- Time: ISO 8601 with offset, for example `2026-12-03T09:02:00+01:00`. All decisions carry `as_of`, taken from the simulated clock, never from `now()`.
- References: `customer_ref` is a keyed hash (`cus_8f3a` in examples, 12 hex characters in practice so refs don't collide at population scale), never a real identifier. Other IDs: `dec_`, `msg_`, `pol_v3`, `prd_`, `exp_`.
- Idempotency: a decision ID is derived from customer, product, and `as_of`, so re-running a decision returns the same record.
- Roles: the demo reads an `X-Role` header (`product_owner`, `campaign_manager`, `compliance`, `dpo`, `customer`). There is no real authentication. Say so in the pitch.
- Simulated data: every response that carries numbers includes `"simulated": true`.
- Errors use one envelope:
```json
{ "error": { "code": "CONSENT_REQUIRED", "message": "No profiling consent on file.", "trace_id": "trc_41c2" } }
```
 
- Pagination: `?limit=50&cursor=...`. Default limit 50.
- Append-only: the consent ledger, decision log, and policy history are never updated in place. Corrections are new entries.
## 3. Reason codes
 
| Code | Meaning | Effect |
|---|---|---|
| `OK` | Passed every check | send |
| `NO_CONSENT` | No profiling consent | silent, nothing else is read |
| `OPTED_OUT` | Customer stopped offers | silent |
| `NO_CHANNEL_CONSENT` | No consent for any usable channel | hold |
| `SENSITIVE_TRIGGER` | Trigger came from a blocked category | hold |
| `NOT_ELIGIBLE` | Fails the product's eligibility rule | candidate dropped |
| `ALREADY_HOLDS` | Customer already uses the product | candidate dropped |
| `NO_MATCH` | No suitable product | silent |
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
 
| Code | Meaning | Effect |
|---|---|---|
| `REWARD_NO_CONSENT` | The event needs consent that is not on file | no award |
| `REWARD_DUPLICATE` | One-time or idempotent award already made | no award |
| `REWARD_CAP_REACHED` | Per-event or 30-day points cap reached | no award |
| `REWARD_INELIGIBLE` | Event type not in the active rules | no award |
| `INSUFFICIENT_POINTS` | Balance too low to redeem | redemption refused |
| `REWARD_OUT_OF_STOCK` | Reward item unavailable | redemption refused |
 
## 4. Core data shapes
 
### Consent
 
```json
{
  "customer_ref": "cus_8f3a",
  "personalised_offers": true,
  "channels": { "app": true, "whatsapp": true, "sms": false, "email": false },
  "updated_at": "2026-11-20T18:41:00+01:00",
  "source": "app_settings"
}
```
 
### Product and eligibility
 
```json
{
  "id": "prd_target_savings",
  "name": "Target savings account",
  "category": "savings",
  "is_credit": false,
  "features": ["Set a goal", "Automatic monthly transfer"],
  "eligibility": { "all": [
    { "fact": "age", "op": ">=", "value": 18 },
    { "fact": "holds", "op": "not_contains", "value": "prd_target_savings" }
  ]},
  "version": 3
}
```
 
Use generic product names in the demo until Abdulhaqeem has checked them against Zenith's real catalogue.
 
### Policy
 
```json
{
  "id": "pol_v3",
  "status": "active",
  "max_messages_per_30d": 2,
  "same_product_gap_days": 60,
  "cooldown_after_ignored_days": 14,
  "quiet_hours": {
    "sms": { "start": "20:00", "end": "08:00" },
    "whatsapp": { "start": "21:00", "end": "07:00" },
    "app": { "start": "22:00", "end": "07:00" }
  },
  "min_uplift": 0.02,
  "credit_requires_review": true,
  "blocked_trigger_categories": ["health", "religion", "politics", "betting"]
}
```
 
These are starting values. Zenith sets the real ones and compliance approves changes.
 
### Decision
 
```json
{
  "id": "dec_a91c",
  "customer_ref": "cus_8f3a",
  "as_of": "2026-12-03T09:02:00+01:00",
  "outcome": "send",
  "product_id": "prd_target_savings",
  "channel": "app",
  "reasons": ["OK"],
  "trace": {
    "triggers": [{ "type": "salary_regular", "evidence": "salary on the 25th, 4 months" },
                 { "type": "fee_season", "evidence": "fees paid each January and September" }],
    "candidates": [{ "product_id": "prd_target_savings", "eligible": true, "uplift": 0.071 }],
    "rules": [{ "rule": "CAP_30D", "passed": true, "detail": "0 of 2 used" }],
    "policy_version": "pol_v3",
    "model_version": "upl_0.3"
  },
  "message": {
    "title": "School fees are coming up",
    "body": "You have paid school fees each January and September, and your salary arrives on the 25th. A target savings account can help you set money aside each month.",
    "why": "Based on your salary and school fee payments. You allowed personalised offers."
  },
  "simulated": true
}
```
 
`outcome` is one of `send`, `hold`, `silent`, `review`.
 
### Rewards
 
All point values below are illustrative. Zenith sets the real ones and compliance approves changes.
 
```json
{
  "id": "rwd_rules_v1",
  "status": "active",
  "earn": [
    { "event": "consent_granted", "purpose": "personalised_offers", "points": 50, "once": true },
    { "event": "preferences_reviewed", "points": 20, "max_per_year": 1 },
    { "event": "offer_feedback", "points": 5, "max_per_30d": 2 },
    { "event": "product_use_milestone", "milestone_days": 60, "points": 100, "max_per_product": 1 }
  ],
  "tiers": [ { "name": "Base", "min_points": 0 }, { "name": "Silver", "min_points": 200 }, { "name": "Gold", "min_points": 600 } ],
  "max_points_per_30d": 150,
  "expiry_months": 12,
  "no_clawback_on_withdrawal": true
}
```
 
Reward account:
 
```json
{
  "customer_ref": "cus_8f3a",
  "balance": 170,
  "lifetime_earned": 170,
  "tier": "Base",
  "next_tier": { "name": "Silver", "points_needed": 30 },
  "ways_to_earn": [ { "event": "preferences_reviewed", "points": 20, "available": true } ],
  "simulated": true
}
```
 
Ledger entry (append-only):
 
```json
{
  "id": "led_77a1", "customer_ref": "cus_8f3a", "type": "earn",
  "event": "consent_granted", "points": 50,
  "idempotency_key": "cus_8f3a:consent_granted:personalised_offers",
  "rules_version": "rwd_rules_v1", "at": "2026-11-20T18:41:00+01:00"
}
```
 
Reward item and redemption:
 
```json
{ "id": "rwi_airtime_500", "name": "Airtime", "points_cost": 100, "kind": "airtime" }
{ "id": "rdm_31c0", "customer_ref": "cus_8f3a", "reward_id": "rwi_airtime_500", "points": 100, "status": "fulfilled" }
```
 
## 5. Endpoints
 
Priority key: **M** must work in the demo, **S** should, **X** stub or slide only.
 
### 5.1 Decision API
 
#### `POST /decisions/evaluate` (M)
 
Runs the full pipeline for one customer.
 
Request:
 
```json
{ "customer_ref": "cus_8f3a", "as_of": "2026-12-03T09:02:00+01:00", "mode": "live" }
```
 
`mode` is `live` (delivers through the gateway) or `dry_run` (records the decision, delivers nothing).
 
Response: a Decision (section 4).
 
Internal steps: see section 6.
 
Errors: `404 CUSTOMER_NOT_FOUND`, `409 SIM_NOT_STARTED`.
 
#### `POST /decisions/batch` (M)
 
Same pipeline over a segment, followed by the governor. Used by experiments and the console.
 
```json
{ "segment": { "ids": ["cus_8f3a", "cus_21bc"] }, "as_of": "2026-12-03T09:00:00+01:00", "mode": "dry_run" }
```
 
Response: `{ "decisions": [...], "counts": { "send": 41, "hold": 112, "silent": 87, "review": 3 } }`.
 
#### `GET /decisions` (M)
 
The silence feed. Filters: `outcome`, `reason`, `product_id`, `customer_ref`, `since`.
 
#### `GET /decisions/{id}` (M)
 
Full Decision with trace.
 
#### `POST /decisions/{id}/approve` and `POST /decisions/{id}/reject` (S)
 
Review queue for held items such as credit offers. Approval hands the message to the delivery planner. Rejection records the reviewer and reason. Requires role `compliance` or `campaign_manager`.
 
### 5.2 Customer surface (the phone view)
 
#### `GET /customers/{ref}/inbox` (M)
 
Messages delivered by the simulated gateway, newest first.
 
#### `POST /messages/{id}/respond` (M)
 
```json
{ "action": "not_now" }
```
 
`action` is `opened`, `accepted`, `not_now`, or `stop_offers`.
 
| Action | What runs |
|---|---|
| `opened` | Outcome tracker records the open |
| `accepted` | Creates the holding in the simulated profile, schedules the 30 and 60 day use checks |
| `not_now` | Sets a cooldown for that product (default 60 days) |
| `stop_offers` | Writes the consent ledger, updates the consent store, cancels scheduled sends, emits `consent_changed`. Applies on every channel immediately |
 
#### `GET /messages/{id}/why` (M)
 
Returns the stored explanation, the categories of data used, and a link to consent controls.
 
#### `GET /customers/{ref}/consent` and `PUT /customers/{ref}/consent` (M)
 
PUT validates the payload, appends to the ledger, updates the store, invalidates cached decisions for that customer, and emits `consent_changed`. The first grant for a purpose also submits a `consent_granted` event to the rewards service (section 5.5), which awards points once.
 
### 5.3 Zenith console
 
#### `GET /metrics/overview` and `GET /metrics/by-product` (M)
 
Sent, held back, opt-outs, and sustained use at 60 days. Aggregates from the outcome tracker. Always includes `"simulated": true`.
 
#### `GET /policies`, `PUT /policies`, `POST /policies/{version}/approve` (S)
 
PUT saves a draft. Approval activates it. Every version is kept. Only `compliance` can approve.
 
#### `POST /policies/simulate` (S)
 
Dry-run of a draft policy over the population snapshot. Returns counts sent and held by reason, so a reviewer sees the effect of a change before approving it.
 
#### `GET /products`, `POST /products`, `PUT /products/{id}` (S)
 
Versioned catalogue. Eligibility predicates are schema-validated JSON. Edits create a new version.
 
#### `POST /campaign-requests` and `GET /campaign-requests/{id}` (S)
 
A product team asks to reach an audience. The governor expands the audience, picks one winner per customer, and records `GOVERNOR_LOST` for the others.
 
```json
{ "product_id": "prd_business_collections", "audience": { "segment": "sme_growing_inflows" }, "priority": 2 }
```
 
#### `GET /audit/log` and `GET /audit/export` (X)
 
Joins the decision log, consent ledger, and policy history. Stub or slide only.
 
### 5.4 Demo control and evidence
 
#### `POST /sim/start`, `POST /sim/reset`, `POST /sim/inject`, `GET /sim/state` (M)
 
```json
{ "seed": 42, "n_customers": 5000, "days": 120, "scenario": "baseline" }
```
 
`inject` adds a pattern on demand: `salary_pattern`, `fee_season`, `sme_growth`. Same seed gives the same population and the same result.
 
#### `POST /experiments/run` and `GET /experiments/{id}` (M)
 
Runs three strategies on the same customers with the same seed:
 
```json
{ "seed": 42, "strategies": ["blast", "caps_only", "matchpoint"], "days": 90 }
```
 
Response metrics per strategy: `messages_per_customer`, `opt_out_rate`, `sustained_adoption_60d`, `fatigue_index`, and for `matchpoint` the `uplift_recovery` (Qini or AUUC against the planted truth). See section 8.
 
#### `POST /model/train` and `GET /model/info` (S)
 
Trains the uplift model on synthetic logs. `info` returns the model version and the Qini score on held-out data.
 
#### `GET /stream` (SSE) and `GET /health` (M)
 
Events:
 
| Event | When |
|---|---|
| `decision_created` | A decision is recorded |
| `message_delivered` | The gateway accepts a message |
| `outcome_recorded` | A response or use check is recorded |
| `consent_changed` | Consent is updated |
| `policy_changed` | A policy is saved or approved |

Each event's `data` is JSON and carries `customer_ref` when it concerns one customer, so the phone view can filter.

### 5.5 Customer accounts and shapes the web app relies on (added for the frontend)

Demo accounts only. There is still no real authentication; the token is opaque and the API may ignore it.

#### `POST /auth/signup` (M)

```json
{ "name": "Amaka Obi", "phone": "08010000001", "password": "demo1234", "persona": "salaried_parent",
  "consent": { "personalised_offers": false, "channels": { "app": true, "whatsapp": false, "sms": false, "email": false } } }
```

`persona` is `salaried_parent`, `sme_owner` or `young_professional` and decides which patterns the simulator plants. Consent from the form is written to the ledger with `source: "signup"`. Everything defaults to off: silence is not consent.

Response: `{ "customer": Customer, "token": "demo_..." }`. Errors: `409 PHONE_TAKEN`, `422 VALIDATION_ERROR`.

#### `POST /auth/signin` (M)

`{ "phone": "...", "password": "..." }` → same response. Error: `401 INVALID_CREDENTIALS`. Seed the four demo accounts listed in `apps/web/src/lib/personas.ts` (`DEMO_ACCOUNTS`).

#### `GET /customers/{ref}` (M)

`{ "customer_ref", "name", "phone", "persona", "age_band", "segment", "holdings": [] }`

#### Shapes

The full contract is `apps/web/src/lib/types.ts`. Points the sections above leave open:

- Lists (`GET /decisions`, `/customers/{ref}/inbox`, `/products`, `/audit/log`) return `{ "items": [...], "next_cursor": null }`.
- Inbox message: `{ id, decision_id, customer_ref, product_id, channel, title, body, why, delivered_at, status, simulated }`, `status` one of `delivered`, `scheduled`, `opened`, `accepted`, `not_now`, `cancelled`.
- `GET /messages/{id}/why`: `{ message_id, why, data_categories: [], consent_url }`.
- `POST /messages/{id}/respond`: `{ message, consent? }` (consent only for `stop_offers`).
- `POST /decisions/{id}/reject` body `{ "reason" }` (required); approve takes an optional `{ "note" }`. The decision gains `review: { action, by, at, note }`.
- `GET /policies`: `{ active_id, items }`. `PUT /policies` and `POST /policies/simulate` take the policy fields without `id`/`status`. Simulate returns `{ counts, by_reason, population, simulated }`.
- `POST /sim/inject`: `{ pattern, customer_ref? }` → `{ pattern, customer_ref, affected }`.
- `POST /experiments/run` → `{ id, seed, days, status, results: [{ strategy, messages_per_customer, opt_out_rate, sustained_adoption_60d, fatigue_index, uplift_recovery? }], created_at, simulated }`.
- `GET /model/info` → `{ version, qini, trained_at, simulated }`.
- Decisions carry `mode` (`live` or `dry_run`) so the customer's activity view only shows decisions that really reached them.
- A send in quiet hours keeps `outcome: "send"`, adds `QUIET_HOURS` to `reasons`, and sets `scheduled_for`.
- Idempotency: the mock also keys decisions on `mode`, and invalidates a customer's cached decisions when consent, holdings or injected patterns change. Otherwise a dry run blocks the live run at the same `as_of`, and Stop offers would not take effect on a re-run.
| `points_awarded` | An earn event is accepted and written to the ledger |
| `points_redeemed` | A redemption is fulfilled |
| `tier_changed` | A customer's tier changes |
 
### 5.5 Rewards (points for customers who share data)
 
The team's working term is "credit points". In the API and on screen, use **reward points** (or a Zenith brand name). "Credit" invites confusion with credit scoring and credit products, which carry review requirements.
 
Reward points are a thank-you for customers who opt in. They are not a credit score.
 
#### Design rules
 
1. **Rewards never gate service.** A customer who does not consent is treated exactly the same for every service.
2. **Consent and rewards are separate.** The consent endpoints work with or without rewards. Withdrawing consent writes to the ledger, stops further earning for that purpose, and does not claw back points already earned (`no_clawback_on_withdrawal`).
3. **Points are not a credit signal.** The reward tier and balance never feed credit eligibility, product eligibility rules for credit products, or the uplift model. If compliance later approves a use, it is added deliberately.
4. **Append-only and idempotent.** Every ledger entry has an idempotency key, so retries never double-award.
5. **Anti-gaming.** One-time awards are keyed to customer and purpose, so toggling consent off and on never re-awards. A 30-day points cap and expiry apply.
6. **Quiet notifications.** Reward notifications go to the app inbox by default, with their own cap, separate from the product-message cap. Compliance classifies them as service or promotional before any SMS is used.
7. **Transparent consent screen.** It shows the reward, says that consent is optional, and says that withdrawing never removes points already earned. These are design choices for compliance to approve.
#### Customer endpoints
 
##### `GET /customers/{ref}/rewards` (M)
 
Returns the reward account, available ways to earn, and the redeemable catalogue.
 
Internal steps: read the ledger and compute balance, tier, and soon-to-expire points. Work out which earn actions are still available (one-time flags, caps). No profile or transaction data is read.
 
##### `GET /customers/{ref}/rewards/history` (S)
 
Paginated ledger entries for the customer, newest first.
 
##### `POST /customers/{ref}/rewards/redeem` (M)
 
```json
{ "reward_id": "rwi_airtime_500" }
```
 
Requires an `Idempotency-Key` header. Internal steps:
 
1. Validate the reward exists and has stock (`REWARD_OUT_OF_STOCK`).
2. Check the balance (`INSUFFICIENT_POINTS`).
3. Write a spend entry to the ledger.
4. Call the `RewardsFulfilment` adapter. If it fails, write a reversal entry and return an error.
5. Recompute the tier and emit `points_redeemed`.
##### `GET /rewards/catalogue` (S)
 
Rewards available for redemption, with point costs. Simulated items only in the demo (for example airtime, a fee waiver, a partner voucher).
 
#### Internal event endpoint
 
##### `POST /rewards/events` (M, system role only)
 
Other services submit earn events here: the consent service (`consent_granted`), the feedback handler (`offer_feedback`), the outcome tracker (`product_use_milestone`).
 
```json
{ "customer_ref": "cus_8f3a", "event": "consent_granted", "purpose": "personalised_offers", "as_of": "2026-11-20T18:41:00+01:00" }
```
 
Internal steps:
 
1. Check the event type is in the active rules (`REWARD_INELIGIBLE`).
2. Build the idempotency key and return the existing award if present (`REWARD_DUPLICATE`).
3. For events tied to data use, check consent on file (`REWARD_NO_CONSENT`).
4. Apply per-event and 30-day caps (`REWARD_CAP_REACHED`).
5. Write the ledger entry.
6. Recompute the tier. Emit `points_awarded` and, if the tier changed, `tier_changed`.
7. Queue an in-app notification within the reward notification cap.
#### Console endpoints
 
##### `GET /rewards/rules`, `PUT /rewards/rules`, `POST /rewards/rules/{version}/approve` (S)
 
Versioned like policies. PUT saves a draft. Only `compliance` can approve.
 
##### `POST /rewards/rules/simulate` (S)
 
Projects points issued, redemption cost, and consent take-up over the synthetic population. Take-up behaviour is a planted assumption in the simulator and the response says so.
 
##### `GET /metrics/rewards` (S)
 
Consent rate, points issued and redeemed, outstanding points liability (points times an assumed unit cost), opt-outs after an award, and tier distribution. Always includes `"simulated": true`.
 
##### `POST /rewards/adjustments` (X)
 
Manual correction by `compliance`, with a required reason. Appends an adjustment entry. Stub or slide only.
 
#### Phone view additions
 
- A **Rewards** screen showing balance, tier, ways to earn, and redeem.
- A reward line on the consent screen: "Turn on personalised offers and earn 50 points. Optional. Turn it off any time and keep your points."
## 6. What `POST /decisions/evaluate` does
 
1. **Load context** through the adapters: profile, holdings, consent, recent contact history.
2. **Consent gate.** No profiling consent returns `NO_CONSENT` and nothing else is read. This is first on purpose.
3. **Detect** triggers from features, then screen for blocked categories (`SENSITIVE_TRIGGER`).
4. **Match** eligible, suitable, not-held products (`NOT_ELIGIBLE`, `ALREADY_HOLDS`, `NO_MATCH`).
5. **Hard rules** for each candidate: `NO_CHANNEL_CONSENT`, `CAP_30D`, `SAME_PRODUCT_60D`, `COOLDOWN_IGNORED`. Quiet hours reschedule instead of dropping. Credit products return `CREDIT_REVIEW`.
6. **Learned rule.** Compare the uplift score with the threshold and the remaining attention budget (`LOW_UPLIFT`, `ATTENTION_BUDGET`).
7. **Governor** (batch only) picks one winner when several products compete for the same customer.
8. **Explain.** Generate the message and its reason from the evidence, then run the guardrail (`GUARDRAIL_BLOCKED`).
9. **Deliver.** Choose the channel and schedule. In `live` mode, hand to the simulated gateway.
10. **Log and emit.** Write the decision with its trace, then push the SSE event.
Hard rules always win over the learned rule. The learned rule can only make the system quieter, never override a rule.
 
## 7. Compliance notes that shape the API
 
- Nigerian data protection rules require consent for direct marketing, including profiling, and silence is not consent. The consent gate runs before anything else.
- CBN consumer protection rules require an opt-out in unsolicited advertisements. Every message carries `stop_offers`.
- Promotional SMS is reported to be allowed only between 08:00 and 20:00 WAT, and the NCC Do Not Disturb registry applies. The SMS quiet-hours default above reflects that. Verify against NCC directives before the pitch.
- Credit products always go to a person. Automated offers of credit can have real consequences for customers.
- No real customer data. Customer references are keyed hashes.
- Consent must be freely given, specific and informed. An incentive for consent raises a real question about whether it is freely given, which is why rewards never gate service, consent stays optional, and withdrawal is penalty-free. Zenith's legal and data protection teams must review this design before any pilot.
- Reward points are not a credit score and must not be presented or used as one.
## 8. Experiment protocol
 
Population: synthetic customers with planted ground-truth response groups (persuadable, sure thing, lost cause, sleeping dog), so the true effect of a message is known.
 
| Strategy | Behaviour |
|---|---|
| `blast` | Messages every eligible customer for every matching product |
| `caps_only` | Same, but with message caps and cooldowns only |
| `matchpoint` | Full pipeline: consent, rules, uplift, attention budget, governor |
 
Report, per strategy: messages per customer, opt-out rate, sustained adoption at 60 days, fatigue index (share of customers receiving more than the cap would allow), and for `matchpoint` the uplift recovery against the planted truth. Use 20 seeds and report median, minimum and maximum. State clearly that the data is synthetic: the numbers show the method works against known ground truth, not production performance.
 
### Consent incentive experiment
 
`POST /experiments/run` with `"scenario": "consent_incentive"` compares `no_reward` and `reward` on the same synthetic population and seed.
 
Report: consent rate, share still consenting at 90 days, opt-outs after an award, points cost per consenting customer. The effect of rewards on consent is a planted assumption in the simulator, so the numbers show that the measurement works, not how real customers will behave. Say so on the slide.
 
Run the three-strategy comparison above with `"rewards_enabled": false`, so points do not inflate the adoption measure.
 
## 9. Build order and ownership
 
| Day | Backend (Olaiwon) | ML and UI (Ayomide) | Product (Abdulhaqeem) |
|---|---|---|---|
| 1 | Simulator, adapters, consent ledger, `evaluate` with hard rules only, `/stream`, points ledger and earn on consent | Feature extraction, detector, matcher, phone view skeleton, consent screen with reward line | Catalogue, personas, policy defaults, rule verification, copy templates, reward catalogue and illustrative earn values |
| 2 | Governor, experiments runner, outcome tracker, `respond` and `why`, redeem, tiers, expiry | Uplift model and attention budget, explainer and guardrail, console shell, Rewards screen | Review each scenario daily, demo script, deck, consent and rewards wording, compliance questions |
| 3 | Policy simulate, rewards simulate, console metrics, stability, one-click reset | Console polish, rewards tab, `consent_incentive` experiment, backup video | Rehearsals, Q and A preparation |
 
Definition of done for the demo:
 
- `POST /sim/start` and `POST /sim/reset` work and are repeatable.
- `evaluate` returns send, hold, silent and review outcomes with reasons and a trace.
- The phone view shows a message, a Why link, and working Not now and Stop offers.
- The silence feed shows suppressed messages with reasons.
- `POST /experiments/run` produces the three-strategy comparison.
- Every number in the console is labelled simulated.
- Granting consent for the first time awards points once, and toggling consent off and on does not award again.
- Redeeming points writes to the ledger and updates the balance.
- Withdrawing consent stops earning and keeps points already earned.
- The console shows consent rate, points issued, and points redeemed, labelled simulated.
## 10. Open items to verify
 
- NCC promotional SMS window and Do Not Disturb handling, from the directive itself.
- Whether in-app and WhatsApp messages need separate consent wording under Zenith's policy.
- Real Zenith product names, eligibility rules, and which products count as credit.
- Facilitator answers: hosted LLM allowed or local only, work after 4 PM, pre-written code and downloaded models.
- Legal view on incentivised consent under Nigerian data protection rules.
- Whether points create an accounting liability for Zenith, and how Zenith would value them.
- Whether reward notifications count as service or promotional messages, and whether fee-waiver rewards are allowed under CBN rules.
- The final name for the points scheme. Avoid anything that sounds like a credit score.