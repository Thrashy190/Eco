// What people on this server play right now, as the server tells it (/api/listening/events). The server says how far
// into the song someone was and how long ago that was true, so the position here moves on with this device's own clock,
// whatever its time zone or drift.
import { toSong } from "./api";
import type { MediaKind, RawSong, Song } from "./types";

/** One person, as the server sends them: no song when nothing plays, or when they keep it to themselves. */
export interface Heard {
  user: string;
  song: (RawSong & { mediaId?: string; kind?: MediaKind }) | null;
  position?: number;
  age_ms?: number;
}

export interface NowPlaying {
  song: Song;
  /** This device's clock when the song was at 0:00. */
  startedAt: number;
}

/** What a person plays, from what the server said and when it arrived here. */
export function nowPlaying(heard: Heard, receivedAt: number): NowPlaying | null {
  if (!heard.song) return null;
  const song: Song = { ...toSong(heard.song), mediaId: heard.song.mediaId, kind: heard.song.kind };
  return { song, startedAt: receivedAt - (heard.age_ms ?? 0) - (heard.position ?? 0) * 1000 };
}

/** Seconds into the song now, never past its end. */
export function positionAt(now: NowPlaying, at: number): number {
  const seconds = Math.max(0, (at - now.startedAt) / 1000);
  return now.song.duration ? Math.min(seconds, now.song.duration) : seconds;
}

/**
 * Whether it still plays. The next song or a pause always arrives as news, so a song a minute past its end means the
 * device went quiet without saying so (a phone asleep).
 */
export const stillPlaying = (now: NowPlaying, at: number) => !now.song.duration || (at - now.startedAt) / 1000 < now.song.duration + 60;
