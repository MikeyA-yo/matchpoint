# MATCHPOINT API guideline (hackathon build)
 
Status: draft v0.1 for the sprint. Owner: backend (Olaiwon), ML and explainer (Ayomide), catalogue, policies and copy (Abdulhaqeem).
 
MATCHPOINT is a decision layer that sits between a bank's product teams and its customers. It decides what to recommend, when, on which channel, and whether to say nothing. Everything outside the decision layer (transactions, products, profiles, consent, channels) is reached through adapters. In the hackathon those adapters are simulators. In a pilot they are replaced by connectors to Zenith's systems, with no change to the services or endpoints below.
 
## 1. Services and adapters
 
| Service | Responsibility |
|---|---|
| Simulator | Simulated clock, synthetic customers with planted ground-truth responses, transaction generator |
| Adapters | `TransactionFeed`, `ProductCatalogue`, `CustomerProfile`, `ConsentStore`, `ChannelGateway`. Simulated now, real in a pilot |
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
 
### Adapter interfaces
 
```python
class TransactionFeed(Protocol):
    def window(self, customer_ref: str, start: datetime, end: datetime) -> list[Txn]: ...
 
class ProductCatalogue(Protocol):
    def active(self, as_of: datetime) -> list[Product]: ...
 
class CustomerProfile(Protocol):
    def get(self, customer_ref: str) -> Profile: ...      # age band, segment, products held
 
class ConsentStore(Protocol):
    def get(self, customer_ref: str) -> Consent: ...
    def set(self, customer_ref: str, consent: Consent) -> Consent: ...
 
class ChannelGateway(Protocol):
    def send(self, msg: OutboundMessage) -> DeliveryReceipt: ...
```
 
Rule: services never import a simulator directly. They receive adapters by dependency injection, so a pilot swaps the implementation, not the code.
 
## 2. Conventions
 
- Base path: `/api/v1`. JSON only. UTF-8.
- Time: ISO 8601 with offset, for example `2026-12-03T09:02:00+01:00`. All decisions carry `as_of`, taken from the simulated clock, never from `now()`.
- References: `customer_ref` is a keyed hash (`cus_8f3a`), never a real identifier. Other IDs: `dec_`, `msg_`, `pol_v3`, `prd_`, `exp_`.
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
 
PUT validates the payload, appends to the ledger, updates the store, invalidates cached decisions for that customer, and emits `consent_changed`.
 
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
## 8. Experiment protocol
 
Population: synthetic customers with planted ground-truth response groups (persuadable, sure thing, lost cause, sleeping dog), so the true effect of a message is known.
 
| Strategy | Behaviour |
|---|---|
| `blast` | Messages every eligible customer for every matching product |
| `caps_only` | Same, but with message caps and cooldowns only |
| `matchpoint` | Full pipeline: consent, rules, uplift, attention budget, governor |
 
Report, per strategy: messages per customer, opt-out rate, sustained adoption at 60 days, fatigue index (share of customers receiving more than the cap would allow), and for `matchpoint` the uplift recovery against the planted truth. Use 20 seeds and report median, minimum and maximum. State clearly that the data is synthetic: the numbers show the method works against known ground truth, not production performance.
 
## 9. Build order and ownership
 
| Day | Backend (Olaiwon) | ML and UI (Ayomide) | Product (Abdulhaqeem) |
|---|---|---|---|
| 1 | Simulator, adapters, consent ledger, `evaluate` with hard rules only, `/stream` | Feature extraction, detector, matcher, phone view skeleton | Catalogue, personas, policy defaults, rule verification, copy templates |
| 2 | Governor, experiments runner, outcome tracker, `respond` and `why` | Uplift model and attention budget, explainer and guardrail, console shell | Review each scenario daily, demo script, deck |
| 3 | Policy simulate, console metrics, stability, one-click reset | Console polish, metrics screen, backup video | Rehearsals, Q and A preparation |
 
Definition of done for the demo:
 
- `POST /sim/start` and `POST /sim/reset` work and are repeatable.
- `evaluate` returns send, hold, silent and review outcomes with reasons and a trace.
- The phone view shows a message, a Why link, and working Not now and Stop offers.
- The silence feed shows suppressed messages with reasons.
- `POST /experiments/run` produces the three-strategy comparison.
- Every number in the console is labelled simulated.
## 10. Open items to verify
 
- NCC promotional SMS window and Do Not Disturb handling, from the directive itself.
- Whether in-app and WhatsApp messages need separate consent wording under Zenith's policy.
- Real Zenith product names, eligibility rules, and which products count as credit.
- Facilitator answers: hosted LLM allowed or local only, work after 4 PM, pre-written code and downloaded models.
 