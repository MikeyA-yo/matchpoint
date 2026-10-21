# Questions for the Zenith mentor

Everything below is a placeholder in the simulator. A pilot needs each confirmed before the real connector is written.

## FLEXCUBE / Oracle Banking (TransactionFeed)

- Confirm the API: Oracle Banking REST (which release and base path), or the legacy FCUBS gateway with `QueryAccTrns`?
- Confirm the field names on the transaction row. The simulator uses `TRN_REF_NO`, `AC_NO`, `TRN_DT`, `VALUE_DT`, `DRCR_IND`, `LCY_AMOUNT`, `TRN_CODE`, `NARRATION`, `RELATED_REF`. All UNVERIFIED.
- Confirm the enumerations for `TRN_CODE` (what codes does Zenith use for salary, NIP in/out, POS, ATM, bills, airtime, charges, stamp duty, reversals?). The simulator uses `SAL`, `NIPI`, `NIPO`, `POS`, `ATM`, `BIL`, `VTU`, `CHG`, `STD`, `REV`.
- How does the real system expose a customer→account mapping — by BVN, by `CUST_NO`, by NUBAN?

## Dataverse (ConsentStore, CustomerProfile)

- Does Zenith use `msdynmkt_contactpointconsent4`, an earlier `*_consent3/2` table, or a custom table with a `zen_` prefix? The simulator doesn't commit to one.
- Which columns hold the purpose, the channel and the opt-in value?
- For `contact`, which columns feed age band, segment, state and holdings?
- Is there a BVN column? If yes, confirm it must never leave the connector.

## WhatsApp (ChannelGateway)

- Zenith uses ZiVA. Is the outbound integration the Meta WhatsApp Cloud API via ZiVA, or a proxy with its own fields?
- Which templates are approved, and what are their names?

## SMS (ChannelGateway)

- Which aggregator does Zenith use, and what are its send and status-callback shapes?
- Is the 08:00–20:00 WAT promotional window still in force? The simulator uses it; the only cited source is NCC's 2016 directive.
- How is partial DND (per category) applied by the aggregator?

## USSD (ChannelGateway)

- USSD is pull-only. Confirm that offer-queued-for-next-session is the right model, and that the simulator's `queued/SESSION_ONLY` receipt matches how Zenith measures delivery.

## Rewards (RewardsFulfilment)

- Airtime provider (VTU aggregator)?
- Voucher partner?
- Fee waiver: is this a FLEXCUBE write, a core-banking exception, or a flag on the customer?

## Nigeria Tax Act 2025 (simulator data)

- The simulator says salary payments are exempt from the ₦50 sender-side stamp duty. The only source is one bank's (UBA's) customer notice. Confirm against the Act's text or an FIRS circular.

## CBN Guide to Charges 2026

- Confirm the version in force on demo day (final guide, or the 21 April exposure draft). The simulator cites both.
