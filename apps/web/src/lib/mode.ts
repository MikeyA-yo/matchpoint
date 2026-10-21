import { KEYS, load, save } from "./storage";

// "mock" runs the in-browser backend in mock.ts; "live" calls the FastAPI server.
// VITE_API_MOCK sets the default; the header toggle overrides it per browser.
export type DataMode = "mock" | "live";

const envDefault: DataMode = import.meta.env.VITE_API_MOCK === "false" ? "live" : "mock";

export function getMode(): DataMode {
  return load<DataMode>(KEYS.mode, envDefault);
}

export function setMode(mode: DataMode): void {
  save(KEYS.mode, mode === envDefault ? null : mode);
  window.location.reload();
}
