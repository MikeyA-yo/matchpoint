import { useCallback } from "react";
import { useApi } from "./context";
import { humanize } from "./format";
import { useQuery } from "./hooks";

// Products a customer can hold that are not in the offer catalogue
const BUILT_IN: Record<string, string> = { prd_current: "Current account" };

/** Returns a lookup from product ID to its customer-facing name. */
export function useProductNames() {
  const api = useApi();
  const products = useQuery(() => api.products(), []);
  return useCallback(
    (id: string | null | undefined) =>
      id ? (products.data?.items.find((p) => p.id === id)?.name ?? BUILT_IN[id] ?? humanize(id)) : "",
    [products.data],
  );
}
