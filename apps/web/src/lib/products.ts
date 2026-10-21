import { useCallback } from "react";
import { useApi } from "./context";
import { humanize } from "./format";
import { useQuery } from "./hooks";

// Names for product IDs that are not in the offer catalogue: holdings, and the API's own
// catalogue, whose IDs predate the Zenith product list. Only exact Zenith equivalents are
// renamed; the API's other products keep their own names until its catalogue is updated.
const KNOWN_NAMES: Record<string, string> = {
  current_account: "Current Account",
  savings_account: "Savings account",
  personal_loan: "Personal Loan",
  prd_target_savings: "Save4Me",
  prd_personal_loan: "Personal Loan",
  prd_salary_advance: "Salary Advance",
  prd_savings_round_up: "Round-up savings",
  prd_fx_card: "Dollar FX card",
  prd_business_collections: "Business collections account",
  prd_bills_autopay: "Bills autopay",
  prd_talk_loans: "Talk to us about loans",
};

/** Returns a lookup from product ID to its catalogue entry, if the catalogue has it. */
export function useProduct() {
  const api = useApi();
  const products = useQuery(() => api.products(), []);
  return useCallback((id: string | null | undefined) => products.data?.items.find((p) => p.id === id), [products.data]);
}

/** Returns a lookup from product ID to its customer-facing name. */
export function useProductNames() {
  const api = useApi();
  const products = useQuery(() => api.products(), []);
  return useCallback(
    (id: string | null | undefined, fallback?: string) =>
      id ? (products.data?.items.find((p) => p.id === id)?.name ?? KNOWN_NAMES[id] ?? fallback ?? humanize(id)) : "",
    [products.data],
  );
}
