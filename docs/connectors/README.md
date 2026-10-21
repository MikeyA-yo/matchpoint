# Connectors

MATCHPOINT reaches every outside system through six adapters. In the demo they are simulators; in a pilot they are connectors to Zenith's systems.

## What each connector does

- **TransactionFeed** — reads account transactions. Shape mirrors Oracle FLEXCUBE's `QueryAccTrns`; the demo generates FLEXCUBE-shaped rows and runs them through the same translator a pilot uses.
- **ConsentStore** — reads and writes consent (personalised offers + per-channel flags). Fails safe: if the source raises, `get()` returns no consent and the pipeline returns `silent`.
- **ChannelGateway** — sends on `app`, `whatsapp`, `sms`, or `ussd`. SMS respects the NCC DND list and the 08:00–20:00 WAT window. USSD is pull-only, so sends return `queued/SESSION_ONLY`.
- **CustomerProfile** — age band, segment, state and holdings. Demo reads a hand-made list.
- **ProductCatalogue** — a hand-written set of Zenith products with `key_facts`, `gain_model` and `compare_group`.
- **RewardsFulfilment** — airtime, voucher, fee waiver; returns `fulfilled`.

## Swapping a simulator for a real connector

Write a transport that implements the connector's `Protocol` (see each `adapters/<name>/connector.py`) over the real system (FLEXCUBE REST, Dataverse Web API, ZiVA, your SMS aggregator, your in-app push service). Flip `ADAPTER_MODE` to `pilot` and wire the HTTP transport into `wiring.build_adapters`. The translation layer is unchanged.

## Fail-safe (fault model)

Consent is the one fault the demo shows: if the consent source raises, the pipeline returns `silent` and nothing else is read. Other faults (duplicates, out-of-order, delay) are modelled by `adapters/faults.FaultInjector`; nothing is wired to it yet.

See [UNVERIFIED.md](UNVERIFIED.md) for the questions to ask the Zenith mentor.
