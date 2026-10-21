const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });

const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
const longDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long" });

/** "3 Dec", or "Thursday 3 December" when long */
export const fmtDay = (iso: string, long = false) => (long ? longDay : day).format(new Date(iso));

export const fmtDateTime =(iso?: string | null) => (iso ? dateTime.format(new Date(iso)) : "—");
export const fmtTime = (iso?: string | null) => (iso ? time.format(new Date(iso)) : "—");
export const fmtNum = (n: number) => n.toLocaleString("en-NG");
export const fmtPct = (n: number, dp = 1) => `${(n * 100).toFixed(dp)}%`;

/** salary_regular -> Salary regular */
export const humanize = (s: string) => {
  const t = s.replace(/^(prd|pol|cus|dec|msg)_/, "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** ISO with +01:00 offset -> value for <input type="datetime-local"> (WAT wall time) */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) + 3_600_000);
  return d.toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (WAT wall time) -> ISO with +01:00 offset */
export function fromLocalInput(value: string): string | undefined {
  return value ? `${value}:00+01:00` : undefined;
}

export function shiftDays(iso: string, days: number): string {
  const d = new Date(Date.parse(iso) + days * 86_400_000 + 3_600_000);
  return d.toISOString().slice(0, 19) + "+01:00";
}

export const CHANNEL_LABEL = { app: "In-app", whatsapp: "WhatsApp", sms: "SMS", email: "Email" } as const;
