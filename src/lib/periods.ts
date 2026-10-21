// The periods of a range, for YourSpotify's "per period" routes (songs_per, time_per…).
// The server returns only periods with plays, identified by date parts ({ year, month, day, hour }
// or { year, week }); this lists every period of the range so curves show the empty ones too.

import { addDays } from "./dates";

export type Split = "hour" | "day" | "week" | "month";

export interface PeriodId {
  year: number;
  month?: number;
  day?: number;
  hour?: number;
  week?: number;
}

export interface Period {
  key: string;
  /** The period's first day (YYYY-MM-DD). */
  day: string;
  hour?: number;
}

/** Hours for a day or two, days up to two months, weeks up to about a year, then months. */
export function splitFor(from: string, to: string): Split {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1;
  return days <= 2 ? "hour" : days <= 62 ? "day" : days <= 400 ? "week" : "month";
}

/** Week number as MongoDB's $week (and the server) count it: weeks start on Sunday, 0–53. */
function weekOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const doy = Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400_000) + 1;
  return Math.floor((doy + 6 - d.getUTCDay()) / 7);
}

export function keyOf(id: PeriodId | null, split: Split): string {
  if (!id) return "all";
  if (split === "week") return `${id.year}-w${id.week}`;
  if (split === "month") return `${id.year}-${id.month}`;
  if (split === "day") return `${id.year}-${id.month}-${id.day}`;
  return `${id.year}-${id.month}-${id.day}-${id.hour}`;
}

/** Every period from `from` to `to` (local days, both included). */
export function periodsOf(from: string, to: string, split: Split): Period[] {
  const out: Period[] = [];
  const seen = new Set<string>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const [y, m, dd] = d.split("-").map(Number);
    if (split === "hour") {
      for (let h = 0; h < 24; h++) out.push({ key: keyOf({ year: y, month: m, day: dd, hour: h }, split), day: d, hour: h });
      continue;
    }
    const key = split === "week" ? keyOf({ year: y, week: weekOf(d) }, split) : split === "month" ? keyOf({ year: y, month: m }, split) : keyOf({ year: y, month: m, day: dd }, split);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, day: d });
  }
  return out;
}
