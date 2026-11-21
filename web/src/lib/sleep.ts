// The sleep timer: the music pauses after a chosen time, like falling asleep to an album. The player keeps the moment
// it ends (stores/player.ts); these are the rules, kept apart so they can be tested.

/** The lengths offered, in minutes. Only these are accepted, from this device or another one. */
export const SLEEP_MINUTES = [5, 10, 15, 20, 30, 45, 60] as const;

/** A length someone asked for, or 0 (turn the timer off) for anything that is not one of the offered lengths. */
export function sleepMinutes(value: unknown): number {
  const minutes = Number(value);
  return (SLEEP_MINUTES as readonly number[]).includes(minutes) ? minutes : 0;
}

/** How a length reads in the menu. */
export const sleepLabel = (minutes: number): string => (minutes === 60 ? "1 hour" : `${minutes} minutes`);

/** Whole seconds left until the timer ends (0 when it is off or has ended), counting a part of a second as one. */
export function sleepLeft(endsAt: number | null | undefined, now: number): number {
  if (!endsAt || !Number.isFinite(endsAt)) return 0;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** When the timer of another device ends, on this device's clock: it said how much was left when it reported. */
export function remoteSleepEnd(left: unknown, heardAt: number | undefined): number | null {
  const seconds = Number(left);
  return seconds > 0 && Number.isFinite(seconds) && heardAt ? heardAt + seconds * 1000 : null;
}

/** The time left as the button shows it: minutes and seconds, or hours too for anything longer. */
export function sleepCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
