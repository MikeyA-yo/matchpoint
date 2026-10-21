// localStorage can throw (private mode, blocked storage), so every access is guarded.

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Non-critical: state just won't survive a reload
  }
}

export const KEYS = {
  session: "matchpoint.session",
  mode: "matchpoint.dataMode",
  role: "matchpoint.consoleRole",
  mockDb: "matchpoint.mockDb.v2",
  technical: "matchpoint.technicalDetails",
} as const;
