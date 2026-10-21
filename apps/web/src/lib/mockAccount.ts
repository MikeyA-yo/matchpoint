// Account history for the mock's customers, after the API's transaction generator
// (apps/api/src/matchpoint/simulator/transactions.py and nigeria.py): bank-style narrations,
// salary on the 25th, POS settlements for traders, and bills, airtime and card spend for
// everyone. The history is drawn from the customer's triggers, so it tells the same story
// the decision engine reads.

import { DEMO_CUSTOMERS } from "./personas";
import type { ActivityKind, Transaction, TxnKind } from "./types";

export interface AccountHolder {
  customer_ref: string;
  segment: string;
  triggers: string[];
}

export interface Account {
  account_no: string;
  balance_kobo: number;
  // Newest first
  transactions: Transaction[];
}

type Row = Pick<Transaction, "at" | "direction" | "kind" | "amount_kobo" | "narration">;

const HISTORY_MONTHS = [9, 10, 11, 12]; // September to December 2026
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const EMPLOYERS = ["DANGOTE INDUSTRIES", "MTN NIGERIA", "ACCESS HOLDINGS", "FLUTTERWAVE NG"];
const MERCHANTS = ["SHOPRITE IKEJA", "SPAR LEKKI", "CHICKEN REPUBLIC VI", "FILLING STATION-NNPC", "MAMA PUT LAGOS", "JUMIA LOGISTICS", "BOLT RIDE"];
const SMALL_MERCHANTS = ["BOLT RIDE", "MAMA PUT LAGOS", "CHICKEN REPUBLIC VI", "UBER TRIP"];
const SENDERS = ["OPAY", "PALMPAY", "MONIEPOINT", "GTB", "ACCESS", "UBA"];
const NETWORKS = ["MTN/080XXXX", "AIRTEL/090XXXX", "GLO/081XXXX"];
const ATMS = ["ATM/ZENITH/IKEJA MALL", "ATM/ZENITH/VICTORIA ISLAND", "ATM/GTB/MARYLAND"];

/** The trigger each activity gives the mock's decision engine (TRIGGERS in mock.ts). */
export const ACTIVITY_TRIGGER: Record<ActivityKind, string> = {
  salary: "salary_regular",
  school_fees: "fee_season",
  pos_sales: "pos_inflow_growth",
  dollar_payment: "international_spend",
  bills: "recurring_bill_pattern",
};

// mulberry32, seeded from a string, so a customer's history is the same on every load
function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const on = (month: number, day: number, hour: number, minute: number) => `2026-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+01:00`;
const daysIn = (month: number) => new Date(Date.UTC(2026, month, 0)).getUTCDate();
const nearest = (naira: number, step = 50) => Math.round(naira / step) * step;

function salaryOf(c: AccountHolder): { employer: string; naira: number } | null {
  const demo = DEMO_CUSTOMERS.find((d) => d.ref === c.customer_ref);
  if (demo?.salary_ngn) return { employer: demo.employer ?? EMPLOYERS[0], naira: demo.salary_ngn };
  if (c.segment !== "salaried") return null;
  const r = seeded(`salary|${c.customer_ref}`);
  return { employer: EMPLOYERS[Math.floor(r() * EMPLOYERS.length)], naira: 250_000 + Math.floor(r() * 60) * 5_000 };
}

/** NUBAN-shaped, starting 22 like the backend's simulator accounts. */
function accountNo(ref: string): string {
  const r = seeded(`nuban|${ref}`);
  return `22${Array.from({ length: 8 }, () => Math.floor(r() * 10)).join("")}`;
}

/** Sender-side ₦50 stamp duty on transfers of ₦10,000 or more (nigeria.py). */
function withStampDuty(rows: Row[], row: Row): void {
  rows.push(row);
  if (row.kind === "nip_out" && row.amount_kobo >= 10_000_00) {
    rows.push({ at: row.at, direction: "debit", kind: "stamp_duty", amount_kobo: 50_00, narration: "STAMP DUTY" });
  }
}

function historyRows(c: AccountHolder): Row[] {
  const r = seeded(`history|${c.customer_ref}`);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const has = (t: string) => c.triggers.includes(t);
  const salary = salaryOf(c);
  const business = c.segment === "trader" || c.segment === "sme";
  const rows: Row[] = [];
  const add = (at: string, direction: Row["direction"], kind: TxnKind, naira: number, narration: string) =>
    withStampDuty(rows, { at, direction, kind, amount_kobo: Math.round(naira * 100), narration });
  const anyDay = (m: number) => 1 + Math.floor(r() * daysIn(m));

  HISTORY_MONTHS.forEach((m, i) => {
    const days = daysIn(m);
    let income = 0;
    if (salary) {
      add(on(m, 25, 9, 12), "credit", "salary", salary.naira, `SALARY/${salary.employer}/${MONTHS[m - 1]} 2026`);
      income += salary.naira;
    }
    if (c.segment === "student") {
      const allowance = 30_000 + Math.floor(r() * 4) * 5_000;
      add(on(m, 1, 10, 5), "credit", "nip_in", allowance, `NIP/${pick(SENDERS)}/TRF FROM MUM`);
      income += allowance;
    }
    if (business) {
      // POS takings settle every few days; they grow month on month when the trigger says so
      const growth = has("pos_inflow_growth") ? 1 + 0.13 * i : 1;
      for (let d = 2; d <= days; d += 2 + Math.floor(r() * 2)) {
        const naira = nearest((22_000 + r() * 48_000) * growth, 100);
        add(on(m, d, 18, 30 + Math.floor(r() * 25)), "credit", "pos", naira, `POS SETTLEMENT/MONIEPOINT TID ${2033 + (d % 7)}`);
        income += naira;
      }
      const stock = nearest(income * (0.45 + r() * 0.15), 1_000);
      add(on(m, 15, 11, 40), "debit", "nip_out", stock, `NIP/${pick(SENDERS)}/STOCK PURCHASE`);
    }

    // Rent, family and savings elsewhere: what is left decides whether the balance builds up
    const keep = has("surplus") ? 0.62 : 0.8;
    if (salary) add(on(m, 26, 8, 15), "debit", "nip_out", nearest(salary.naira * keep * (0.5 + r() * 0.1), 1_000), `NIP/${pick(SENDERS)}/TRF TO FAMILY`);
    if (salary) add(on(m, 27, 19, 2), "debit", "nip_out", nearest(salary.naira * keep * 0.3, 1_000), "NIP/ACCESS/RENT CONTRIBUTION");

    const small = has("small_frequent_spend");
    for (let k = 0; k < (small ? 12 : 5); k++) {
      const naira = small ? nearest(800 + r() * 3_900) : nearest(3_500 + r() * 22_000);
      add(on(m, anyDay(m), 8 + Math.floor(r() * 12), Math.floor(r() * 60)), "debit", "pos", naira, `POS/${pick(small ? SMALL_MERCHANTS : MERCHANTS)}`);
    }
    for (let k = 0; k < 2; k++) add(on(m, anyDay(m), 7 + Math.floor(r() * 14), Math.floor(r() * 60)), "debit", "airtime", 500 * (2 + Math.floor(r() * 5)), `VTU/${pick(NETWORKS)}`);
    if (r() < 0.6) add(on(m, anyDay(m), 13, 20), "debit", "atm", 20_000, pick(ATMS));

    if (has("recurring_bill_pattern")) {
      add(on(m, 5, 10, 3), "debit", "bill", 24_500, "DSTV SUBSCRIPTION");
      add(on(m, 10, 18, 44), "debit", "bill", 20_000, "IKEDC PREPAID TOKEN");
    } else if (r() < 0.5) {
      add(on(m, anyDay(m), 18, 44), "debit", "bill", 10_000, "EKEDC PREPAID TOKEN");
    }
    if (has("international_spend")) {
      add(on(m, 7, 21, 10), "debit", "other", 11_500, "WEB PMT/USD/NETFLIX.COM");
      add(on(m, anyDay(m), 22, 35), "debit", "other", nearest(30_000 + r() * 50_000), "WEB PMT/USD/AMAZON.COM");
    }
    if (has("betting_spend")) {
      for (let k = 0; k < 3; k++) add(on(m, anyDay(m), 20, 15), "debit", "nip_out", 1_000 * (2 + Math.floor(r() * 4)), "NIP/PAYSTACK/BET9JA WALLET");
    }
    if (has("fee_season") && m === 9) add(on(9, 7, 11, 20), "debit", "nip_out", 450_000, "SCHOOL FEES - GREENSPRING SCHOOL");
    add(on(m, days, 23, 50), "debit", "charge", 120, "SMS ALERT CHARGES");
  });
  return rows;
}

function toTransactions(ref: string, rows: Row[], from: number): Transaction[] {
  return rows.map((row, i) => ({ id: `txn_${ref.slice(4, 10)}${String(from + i).padStart(5, "0")}`, customer_ref: ref, currency: "NGN", simulated: true, ...row }));
}

/** History up to `until`, with an opening balance that never lets the account go overdrawn. */
export function openAccount(c: AccountHolder, until: string): Account {
  const end = Date.parse(until);
  const rows = historyRows(c)
    .filter((row) => Date.parse(row.at) <= end)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let running = 0;
  let lowest = 0;
  for (const row of rows) {
    running += row.direction === "credit" ? row.amount_kobo : -row.amount_kobo;
    lowest = Math.min(lowest, running);
  }
  const cushion = (c.triggers.includes("surplus") ? 320_000 : 40_000 + Math.floor(seeded(`open|${c.customer_ref}`)() * 60_000)) * 100;
  const opening = -lowest + cushion;
  return {
    account_no: accountNo(c.customer_ref),
    balance_kobo: opening + running,
    transactions: toTransactions(c.customer_ref, rows, 0).reverse(),
  };
}

/** Rows for one sandbox activity at `at`. Throws if a payment is more than the balance. */
export function postActivity(acct: Account, c: AccountHolder, kind: ActivityKind, at: string): Transaction[] {
  const r = seeded(`${c.customer_ref}|${acct.transactions.length}`);
  const later = (minutes: number) => new Date(Date.parse(at) + minutes * 60_000 + 3_600_000).toISOString().slice(0, 19) + "+01:00";
  const month = MONTHS[Number(at.slice(5, 7)) - 1];
  const rows: Row[] = [];
  const add = (atIso: string, direction: Row["direction"], kindOf: TxnKind, naira: number, narration: string) =>
    withStampDuty(rows, { at: atIso, direction, kind: kindOf, amount_kobo: Math.round(naira * 100), narration });

  switch (kind) {
    case "salary": {
      const s = salaryOf(c) ?? { employer: EMPLOYERS[0], naira: 350_000 };
      add(at, "credit", "salary", s.naira, `SALARY/${s.employer}/${month} ${at.slice(0, 4)}`);
      break;
    }
    case "school_fees":
      add(at, "debit", "nip_out", 350_000, "SCHOOL FEES - GREENSPRING SCHOOL");
      break;
    case "pos_sales":
      for (let k = 0; k < 4; k++) add(later(k * 7), "credit", "pos", nearest(38_000 + r() * 34_000, 100), `POS SETTLEMENT/MONIEPOINT TID ${2033 + k}`);
      break;
    case "dollar_payment":
      add(at, "debit", "other", 48_600, "WEB PMT/USD/AMAZON.COM");
      break;
    case "bills":
      add(at, "debit", "bill", 24_500, "DSTV SUBSCRIPTION");
      add(later(2), "debit", "bill", 20_000, "IKEDC PREPAID TOKEN");
      break;
  }

  const out = rows.reduce((sum, row) => sum + (row.direction === "debit" ? row.amount_kobo : -row.amount_kobo), 0);
  if (out > acct.balance_kobo) throw new RangeError("INSUFFICIENT_FUNDS");
  const posted = toTransactions(c.customer_ref, rows, acct.transactions.length);
  acct.balance_kobo -= out;
  acct.transactions.unshift(...[...posted].reverse());
  return posted;
}
