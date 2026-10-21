// Days as "YYYY-MM-DD" strings (the user's local days, as the server reports them).

export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const addMonths = (day: string, n: number): string => {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

export const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
export const dayOfMonth = (day: string) => Number(day.slice(8, 10));
export const startOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
export const startOfWeek = (day: string, weekStart: number) => addDays(day, -((weekday(day) - weekStart + 7) % 7));
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400_000);

/** Today in the user's time zone (not the browser's). */
export function today(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
