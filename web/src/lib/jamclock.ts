// Keeping a device with a Jam (stores/jam.ts). The server keeps the Jam's time; each device measures how far its own
// clock is from the server's, then plays where the song should be by now, and jumps when it drifts too far.

/** One question to the server's clock: when it left here, the server's answer, and when the answer arrived (all ms). */
export interface Ping {
  sent: number;
  server: number;
  received: number;
}

/**
 * How far ahead of this device the server's clock is, in milliseconds. The answer is taken to have been made halfway
 * through its trip, and the quickest trip says it best: a slow one was slowed on the way, by an amount nobody knows.
 */
export function clockOffset(pings: Ping[]): number {
  let best: Ping | null = null;
  for (const p of pings) if (p.received >= p.sent && (!best || p.received - p.sent < best.received - best.sent)) best = p;
  return best ? Math.round(best.server - (best.sent + best.received) / 2) : 0;
}

export interface JamPlayback {
  entry: string;
  position: number;
  at: number;
  paused: boolean;
}

/** Where the Jam's song is at serverNow (the server's clock, ms), in seconds. */
export function jamPosition(p: JamPlayback, serverNow: number): number {
  if (!p.entry || p.paused) return p.position;
  return Math.max(0, p.position + (serverNow - p.at) / 1000);
}

/** How far a device may be from the others before it jumps: less is not heard, and jumping more often is. */
export const DRIFT = 0.35;
export const offBeat = (here: number, there: number) => Math.abs(here - there) > DRIFT;
