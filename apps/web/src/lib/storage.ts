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
  mockDb: "matchpoint.mockDb.v4",
  technical: "matchpoint.technicalDetails",
  restorePoints: "matchpoint.restorePoints",
} as const;

// ---- Demo data: what a reset clears and a restore point captures ----

const PREFIX = "matchpoint.";
// Sign-in, preferences and the restore points themselves are not demo data
const NOT_DATA = new Set<string>([KEYS.session, KEYS.mode, KEYS.role, KEYS.technical, KEYS.restorePoints]);

export interface RestorePoint {
  id: string;
  name: string;
  saved_at: string;
  // Raw localStorage values, by key
  data: Record<string, string>;
}

function storageKeys(): string[] {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}

/** Every localStorage key holding demo data: the mock database, sandbox dates and so on. */
export function demoDataKeys(): string[] {
  return storageKeys().filter((k) => k.startsWith(PREFIX) && !NOT_DATA.has(k));
}

/** Removes mock databases from earlier versions of the app; nothing reads them. */
export function dropStaleData(): void {
  for (const k of storageKeys()) {
    if (k.startsWith(`${PREFIX}mockDb.`) && k !== KEYS.mockDb) localStorage.removeItem(k);
  }
}

export function clearDemoData(): void {
  for (const k of demoDataKeys()) localStorage.removeItem(k);
}

export const listRestorePoints = () => load<RestorePoint[]>(KEYS.restorePoints, []);

/** Snapshots the current demo data. Throws if the browser's storage is full. */
export function saveRestorePoint(name: string): RestorePoint {
  const data = Object.fromEntries(demoDataKeys().map((k) => [k, localStorage.getItem(k) ?? ""]));
  const point: RestorePoint = { id: crypto.randomUUID(), name, saved_at: new Date().toISOString(), data };
  localStorage.setItem(KEYS.restorePoints, JSON.stringify([point, ...listRestorePoints()]));
  return point;
}

/** Replaces the current demo data with the snapshot's. */
export function restoreTo(point: RestorePoint): void {
  clearDemoData();
  for (const [k, v] of Object.entries(point.data)) localStorage.setItem(k, v);
}

export function deleteRestorePoint(id: string): void {
  save(KEYS.restorePoints, listRestorePoints().filter((p) => p.id !== id));
}

/** Size of a set of stored values, e.g. "212 KB". */
export function sizeOf(data: Record<string, string>): string {
  const bytes = Object.entries(data).reduce((n, [k, v]) => n + (k.length + v.length) * 2, 0);
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}
