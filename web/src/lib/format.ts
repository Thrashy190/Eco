// Small formatting helpers with no dependencies, so they can be unit tested without a browser.
import type { Song } from "./types";

export const clock = (seconds?: number): string =>
  seconds !== undefined && Number.isFinite(seconds) && seconds >= 0
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "0:00";

export function greeting(hour = new Date().getHours()): string {
  return hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 19 ? "Good afternoon" : "Good evening";
}

/** Two letters for an avatar when there is no picture. */
export const initials = (name: string): string =>
  (name.match(/[\p{L}\p{N}]+/gu) ?? ["?"]).slice(0, 2).map((w) => [...w][0]).join("").toUpperCase();

/** A stable hue from a string, so each artist keeps the same avatar colour. */
export function hue(text: string): number {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return hash;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export const megabytes = (bytes: number): string =>
  (bytes / 1048576 < 10 ? (bytes / 1048576).toFixed(1) : String(Math.round(bytes / 1048576))) + " MB";

/** A readable default name for this device, from the browser's description of itself. */
export function deviceName(userAgent: string): string {
  const system = /iPhone/.test(userAgent) ? "iPhone" : /iPad/.test(userAgent) ? "iPad" : /Android/.test(userAgent) ? "Android"
    : /Mac OS X/.test(userAgent) ? "Mac" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "";
  return [browser, system].filter(Boolean).join(" on ") || "This browser";
}

const YOUTUBE = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;
export const isYoutubeLink = (text: string): boolean => YOUTUBE.test(text.trim());

const nameKey = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** People whose tags separated them with a semicolon, which only ever means several artists. */
const separated = new Set<string>();

/** Navidrome splits a tag on "; " into separate artists. On screen it reads like any other list of names. */
export function readableArtists(name: string): string {
  if (!name?.includes("; ")) return name;
  const parts = name.split("; ").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) separated.add(nameKey(part));
  return parts.join(", ");
}

/**
 * Older songs keep every artist in one tag ("Bad Bunny, Chuwi"), but a comma can also be part of a name ("Tyler,
 * The Creator"). So it only counts as a separator when one of the pieces is a known artist.
 */
export function splitArtists(name: string, known: ReadonlySet<string>): string[] {
  const parts = name.split(/,\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 && parts.some((part) => known.has(nameKey(part)) || separated.has(nameKey(part))) ? parts : [name];
}

/**
 * Who counts as an artist in their own right: anyone listed alone, or named in more than one group. The library often
 * lists only groups ("Offset, Metro Boomin" and "21 Savage, Offset, Metro Boomin"), while a name that merely contains
 * a comma shows up once.
 */
export function knownArtists(names: string[]): Set<string> {
  const known = new Set<string>();
  const inGroups = new Map<string, number>();
  for (const name of names) {
    if (!name.includes(", ")) { known.add(nameKey(name)); continue; }
    for (const part of name.split(/,\s+/)) {
      const key = nameKey(part);
      inGroups.set(key, (inGroups.get(key) ?? 0) + 1);
      if ((inGroups.get(key) ?? 0) > 1) known.add(key);
    }
  }
  return known;
}

/**
 * An artist's songs: those on their own albums, in the order of the albums, and those on other people's ("Appears on"),
 * where they are one of several artists. Navidrome only lists the albums an artist made, so both come from Eco.
 */
export function splitOwn(songs: Song[], albumIds: string[]): { own: Song[]; elsewhere: Song[] } {
  const place = new Map(albumIds.map((id, k) => [id, k]));
  const own = songs.filter((s) => s.albumId !== undefined && place.has(s.albumId));
  own.sort((a, b) => place.get(a.albumId!)! - place.get(b.albumId!)!); // stable: each album keeps its order
  return { own, elsewhere: songs.filter((s) => s.albumId === undefined || !place.has(s.albumId)) };
}
