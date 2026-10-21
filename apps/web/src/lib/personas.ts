import type { Channel, Pattern, Persona } from "./types";

interface Seed {
  age_band: string;
  segment: string;
  holdings: string[];
  // Trigger types the simulator plants (see TRIGGERS in mock.ts), and how much an offer helps
  triggers: string[];
  uplift: number;
}

// A persona decides which synthetic transaction patterns the simulator plants for a new sign-up.
export const PERSONAS: Record<Persona, Seed & { label: string; description: string }> = {
  salaried_parent: {
    label: "Salaried parent",
    description: "Salary on the 25th, school fees each January and September.",
    age_band: "35-44",
    segment: "salaried",
    holdings: ["current_account"],
    triggers: ["salary_regular", "fee_season"],
    uplift: 1,
  },
  sme_owner: {
    label: "Small business owner",
    description: "POS sales growing month on month.",
    age_band: "25-34",
    segment: "sme",
    holdings: ["current_account"],
    triggers: ["pos_inflow_growth"],
    uplift: 1,
  },
  young_professional: {
    label: "Young professional",
    description: "Lots of small card payments, and some betting spend.",
    age_band: "18-24",
    segment: "salaried",
    holdings: ["savings_account"],
    triggers: ["small_frequent_spend", "betting_spend"],
    uplift: 0.4,
  },
};

const ALL_OFF: Record<Channel, boolean> = { app: false, whatsapp: false, sms: false, email: false, ussd: false };

/**
 * The backend's seven demo customers (apps/api/src/matchpoint/simulator/population.py), so the
 * mock and the live API describe the same people. Refs are HMACs under the default sim
 * REF_HMAC_KEY; regenerate with `uv run python scripts/print_demo_refs.py` if the key changes.
 */
export const DEMO_CUSTOMERS: (Seed & {
  key: string;
  name: string;
  ref: string;
  phone: string;
  channels: Record<Channel, boolean>;
  personalised_offers: boolean;
  complaint_open?: boolean;
  // Shown under the name on the sign-in screen
  note: string;
})[] = [
  {
    key: "adaeze", name: "Adaeze Okafor", ref: "cus_231e711a96dd", phone: "08010000001",
    age_band: "25-34", segment: "salaried", holdings: ["current_account"],
    channels: { ...ALL_OFF, app: true, whatsapp: true, email: true }, personalised_offers: true,
    triggers: ["salary_regular"], uplift: 1,
    note: "Salaried · Lagos",
  },
  {
    key: "musa", name: "Musa Ibrahim", ref: "cus_e9cdc97df521", phone: "08010000002",
    age_band: "35-44", segment: "trader", holdings: ["current_account"],
    channels: { ...ALL_OFF, app: true, whatsapp: true, sms: true, ussd: true }, personalised_offers: true,
    triggers: ["pos_inflow_growth"], uplift: 1,
    note: "Trader · Kano",
  },
  {
    key: "tunde", name: "Tunde Bakare", ref: "cus_36313be70c65", phone: "08010000003",
    age_band: "35-44", segment: "salaried", holdings: ["current_account", "savings_account"],
    channels: { ...ALL_OFF, app: true, whatsapp: true, sms: true, email: true }, personalised_offers: true,
    triggers: ["salary_regular", "fee_season"], uplift: 1,
    note: "Salaried · Abuja",
  },
  {
    key: "chiamaka", name: "Chiamaka Eze", ref: "cus_c4f03e1addc1", phone: "08010000004",
    age_band: "25-34", segment: "sme", holdings: ["current_account"],
    channels: { ...ALL_OFF, app: true, whatsapp: true, sms: true, email: true }, personalised_offers: true,
    triggers: ["pos_inflow_growth", "international_spend"], uplift: 1,
    note: "Small business · Port Harcourt",
  },
  {
    key: "emeka", name: "Emeka Nwosu", ref: "cus_880ac62d1326", phone: "08010000005",
    age_band: "45-54", segment: "salaried", holdings: ["current_account", "savings_account", "personal_loan"],
    channels: { ...ALL_OFF, app: true, sms: true, email: true }, personalised_offers: true,
    triggers: ["salary_regular", "recurring_bill_pattern"], uplift: 0.25,
    note: "Salaried · Lagos",
  },
  {
    key: "ngozi", name: "Ngozi Afolabi", ref: "cus_6a4623110642", phone: "08010000006",
    age_band: "18-24", segment: "student", holdings: ["savings_account"],
    channels: { ...ALL_OFF, app: true }, personalised_offers: false,
    triggers: ["small_frequent_spend"], uplift: 1,
    note: "Student · Enugu",
  },
  {
    key: "halima", name: "Halima Yusuf", ref: "cus_7d21914ee433", phone: "08010000007",
    age_band: "35-44", segment: "salaried", holdings: ["current_account"],
    channels: { ...ALL_OFF, app: true, whatsapp: true, sms: true, email: true }, personalised_offers: true,
    complaint_open: true, triggers: ["salary_regular"], uplift: 1,
    note: "Salaried · Kaduna",
  },
];

export const DEMO_PASSWORD = "demo1234";

export const PATTERN_TRIGGER: Record<Pattern, string> = {
  salary_pattern: "salary_regular",
  fee_season: "fee_season",
  sme_growth: "pos_inflow_growth",
};

export const SEGMENTS = ["all", "salaried", "trader", "sme", "student"];

const SEGMENT_NAMES: Record<string, string> = {
  all: "All customers",
  salaried: "Salaried",
  trader: "Trader",
  sme: "Small business",
  student: "Student",
};
export const segmentLabel = (s: string) => SEGMENT_NAMES[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
