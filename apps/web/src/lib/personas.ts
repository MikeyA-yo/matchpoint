import type { Pattern, Persona } from "./types";

// A persona decides which synthetic transaction patterns the simulator plants for a new customer.
export const PERSONAS: Record<
  Persona,
  { label: string; description: string; age_band: string; segment: string; holdings: string[]; triggers: string[] }
> = {
  salaried_parent: {
    label: "Salaried parent",
    description: "Salary on the 25th, school fees each January and September.",
    age_band: "35-44",
    segment: "salaried_parents",
    holdings: ["prd_current"],
    triggers: ["salary_regular", "fee_season"],
  },
  sme_owner: {
    label: "Small business owner",
    description: "Business inflows growing month on month.",
    age_band: "25-34",
    segment: "sme_growing_inflows",
    holdings: ["prd_current", "prd_business_collections"],
    triggers: ["sme_inflow_growth"],
  },
  young_professional: {
    label: "Young professional",
    description: "First salary, irregular saving, some betting spend.",
    age_band: "18-24",
    segment: "young_professionals",
    holdings: ["prd_current"],
    triggers: ["salary_regular", "betting_spend"],
  },
};

export const PATTERN_TRIGGER: Record<Pattern, string> = {
  salary_pattern: "salary_regular",
  fee_season: "fee_season",
  sme_growth: "sme_inflow_growth",
};

export const SEGMENTS = ["all", "salaried_parents", "sme_growing_inflows", "young_professionals"];

// Seeded accounts for the sign-in page. The backend should seed the same ones.
export const DEMO_ACCOUNTS = [
  { name: "Amaka Obi", phone: "08010000001", password: "demo1234", persona: "salaried_parent", note: "Likely to get a savings offer" },
  { name: "Tunde Bakare", phone: "08010000002", password: "demo1234", persona: "sme_owner", note: "Loan offers are checked by a person first" },
  { name: "Zainab Musa", phone: "08010000003", password: "demo1234", persona: "young_professional", note: "MATCHPOINT mostly stays quiet" },
  { name: "Chidi Eze", phone: "08010000004", password: "demo1234", persona: "salaried_parent", note: "Said no to offers, so never contacted" },
] as const satisfies readonly { persona: Persona; [k: string]: string }[];
