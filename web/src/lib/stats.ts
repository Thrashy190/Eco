// What the statistics page computes from the server's numbers. Pure, so it is tested without a browser.
import type { StatsBucket, StatsSummary } from "./types";

/** The periods the page offers, as the server names them. */
export const RANGES: [string, string][] = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["365d", "Year"], ["all", "All time"]];
export const DEFAULT_RANGE = "30d";
export const validRange = (value: unknown): string => (RANGES.some(([id]) => id === value) ? (value as string) : DEFAULT_RANGE);

/** "45 min", "12 h 5 min", "1,204 h": hours stop showing minutes once they are many. */
export function listened(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours >= 100 || rest === 0 ? `${hours.toLocaleString("en-US")} h` : `${hours} h ${rest} min`;
}

/** A number with thousands separated: 12,345. */
export const count = (n: number): string => Math.round(n).toLocaleString("en-US");

/**
 * How a number moved since the period before, as a whole percentage. Nothing to compare with (no period before, or
 * nothing in it) gives null, never Infinity or NaN.
 */
export function change(now: number, before: number | undefined): number | null {
  if (before === undefined || !Number.isFinite(before) || before <= 0 || !Number.isFinite(now)) return null;
  return Math.round(((now - before) / before) * 100);
}

/** "+12%", "−8%", "Same": the minus is a real one. */
export const changeLabel = (pct: number): string => (pct === 0 ? "Same as before" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% vs before`);

/** The part of a whole, as a whole percentage, never NaN. */
export const share = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A bucket's start (2026-11-02) written for people: "Nov 2", "Week of Nov 2", "Nov 2026". */
export function bucketLabel(start: string, step: StatsSummary["step"]): string {
  const [y, m, d] = start.split("-").map(Number);
  if (!y || !m || !d) return start;
  const month = MONTHS[m - 1];
  if (step === "month") return `${month} ${y}`;
  return step === "week" ? `Week of ${month} ${d}` : `${month} ${d}`;
}

/** Which buckets get a label under the chart: about six, evenly spread, always the first and last. */
export function tickIndexes(length: number, wanted = 6): number[] {
  if (length <= 0) return [];
  if (length <= wanted) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (wanted - 1);
  return [...new Set(Array.from({ length: wanted }, (_, i) => Math.round(i * step)))];
}

/** The busiest hour of the day, as "9 PM", or "" with no plays. */
export function peakHour(hours: number[]): string {
  let best = -1;
  hours.forEach((n, i) => { if (n > 0 && (best < 0 || n > hours[best])) best = i; });
  return best < 0 ? "" : hourLabel(best);
}

export const hourLabel = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Minutes a day over the period: the days with music, so a new server is not shown as mostly silent. */
export const perDay = (minutes: number, activeDays: number): number => (activeDays > 0 ? Math.round(minutes / activeDays) : 0);

/** The tallest bucket, at least 1 so bars never divide by zero. */
export const tallest = (values: number[]): number => Math.max(1, ...values);

/** Minutes of each bucket, which is what the timeline shows. */
export const bucketMinutes = (timeline: StatsBucket[]): number[] => timeline.map((b) => b.minutes);

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the date. */
export function ago(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || new Date(at).getFullYear() < 2000) return "";
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const date = new Date(at);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
