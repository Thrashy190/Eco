// Talking to the server: the Subsonic API (through eco's /rest passthrough) and eco's own /api.
import { md5 } from "./md5.js";

const KEY = "eco.session";
let session = null;
try { session = JSON.parse(localStorage.getItem(KEY)); } catch { /* storage unavailable: sign in every time */ }
if (!(session?.u && session?.t && session?.s)) session = null;

const listeners = new Set();
let signingIn = false; // while true, a rejected login is a form error, not an expired session
/** Run fn when the session ends (signed out, or the server rejected it). */
export const onSignedOut = (fn) => listeners.add(fn);

export const signedIn = () => session !== null;
export const username = () => session?.u ?? "";

/** The signature never contains the password: t = md5(password + salt). */
export async function signIn(user, password) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const candidate = { u: user.trim(), s: salt, t: md5(password + salt) };
  const previous = session;
  session = candidate;
  signingIn = true;
  try {
    await subsonic("ping");
  } catch (e) {
    session = previous;
    throw e;
  } finally {
    signingIn = false;
  }
  try { localStorage.setItem(KEY, JSON.stringify(candidate)); } catch { /* ignore */ }
}

export function signOut() {
  session = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

const params = (extra = {}) => new URLSearchParams({ u: session.u, t: session.t, s: session.s, v: "1.16.1", c: "eco", f: "json", ...extra });

/** URL of the audio stream. format=raw asks Navidrome not to transcode: you hear the file as it is. */
export const streamUrl = (id) => `/rest/stream?${params({ id, format: "raw" })}`;
export const mediaFileUrl = (id) => `/api/media/${id}/file?${params()}`;
export const mediaThumbUrl = (id) => `/api/media/${id}/thumb?${params()}`;
/** Where a song's or episode's audio comes from. Imported media is served by eco itself, music by Navidrome. */
export const sourceUrl = (song) => (song.mediaId ? mediaFileUrl(song.mediaId) : streamUrl(song.id));
export const coverUrl = (id, size = 300) => (id ? `/rest/getCoverArt?${params({ id, size })}` : "");

async function request(url, options) {
  let response;
  try { response = await fetch(url, options); } catch { throw new Error("No connection to the server"); }
  if (response.status === 401 && !signingIn) { signOut(); throw new Error("Your session expired"); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Server error ${response.status}`);
  return body;
}

/** Call a Subsonic endpoint and return its response body. */
export async function subsonic(endpoint, extra) {
  const body = (await request(`/rest/${endpoint}?${params(extra)}`))["subsonic-response"];
  if (body.status !== "ok") {
    if ((body.error?.code === 40 || body.error?.code === 41) && !signingIn) signOut();
    throw new Error(body.error?.message || "Navidrome returned an error");
  }
  return body;
}

/** Call one of eco's own endpoints. */
export const eco = (path, extra, method = "GET") => request(`/api/${path}?${params(extra)}`, { method });

// Normalise Subsonic objects into the shape the UI uses everywhere.
export const song = (s) => ({ id: s.id, title: s.title, artist: s.artist, artistId: s.artistId ?? s.artist_id, album: s.album,
  albumId: s.albumId ?? s.album_id, duration: s.duration, cover: s.coverArt ?? s.cover, starred: s.starred ?? "" });
export const album = (a) => ({ id: a.id, name: a.name, artist: a.artist, artistId: a.artistId ?? a.artist_id,
  cover: a.coverArt ?? a.cover, songCount: a.songCount ?? a.song_count, year: a.year });

export const getAlbum = async (id) => {
  const a = (await subsonic("getAlbum", { id })).album;
  return { ...album(a), songs: (a.song ?? []).map(song) };
};
export const getArtist = async (id) => {
  const a = (await subsonic("getArtist", { id })).artist;
  return { id: a.id, name: a.name, cover: a.coverArt, albums: (a.album ?? []).map(album) };
};
export const getArtists = async () => {
  const index = (await subsonic("getArtists")).artists.index ?? [];
  return index.flatMap((group) => group.artist ?? []).map((a) => ({ id: a.id, name: a.name, cover: a.coverArt, albumCount: a.albumCount }));
};
export const getPlaylists = async () => ((await subsonic("getPlaylists")).playlists.playlist ?? []).map((p) => ({ id: p.id, name: p.name, songCount: p.songCount, cover: p.coverArt }));
export const getPlaylist = async (id) => {
  const p = (await subsonic("getPlaylist", { id })).playlist;
  return { id: p.id, name: p.name, cover: p.coverArt, songs: (p.entry ?? []).map(song) };
};
/** Tell Navidrome a song was played, which feeds "recently played" and "most played". */
export const scrobble = (id) => subsonic("scrobble", { id, submission: "true" }).catch(() => {});

/** Favourite songs, the most recently favourited first. */
export const getStarred = async () => ((await subsonic("getStarred2")).starred2.song ?? []).map(song)
  .sort((a, b) => (a.starred < b.starred ? 1 : a.starred > b.starred ? -1 : 0));
export const star = (id) => subsonic("star", { id });
export const unstar = (id) => subsonic("unstar", { id });

/** The picture for a song: Navidrome cover art, or the thumbnail of an imported video/episode. Empty if none. */
export const songCover = (song, size = 300) => (song.mediaId ? mediaThumbUrl(song.mediaId) : coverUrl(song.cover, size));
export const hasCover = (song) => Boolean(song.mediaId || song.cover);

// ---- Imported media (videos, podcasts, audiobooks, other) ----
export const KINDS = [["podcast", "Podcast"], ["audiobook", "Audiobook"], ["video", "Video"], ["other", "Other"]];
export const kindLabel = (kind) => KINDS.find(([k]) => k === kind)?.[1] ?? "Other";
export const mediaPreview = (url) => eco("media/preview", { url });
export const mediaImport = (url, kind, format, height) => eco("media/import", { url, kind, format, height }, "POST");
export const listMedia = async (kind) => (await eco("media", kind ? { kind } : {})).items;
export const deleteMedia = (id) => request(`/api/media/${id}?${params()}`, { method: "DELETE" });
/** An imported item shaped like a song, so the same player and rows can handle it. */
export const mediaSong = (item) => ({ id: `m-${item.id}`, mediaId: item.id, title: item.title, artist: item.channel,
  album: kindLabel(item.kind), duration: item.duration, kind: item.kind, format: item.format, size: item.size });
