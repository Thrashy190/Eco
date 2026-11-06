// Talking to the server: the Subsonic API (through eco's /rest passthrough) and eco's own /api.
import { create } from "zustand";
import { readableArtists } from "./format";
import { md5 } from "./md5";
import type {
  Album, AlbumDetail, AlbumTrack, Artist, ArtistDetail, CatalogAlbumPage, CleanupReport, DiscoverResponse, ExternalAlbum, ExternalSearch, HomeResponse,
  ImportDetail, ImportedList, ImportRow, ImportSummary, Job, LibraryEntry, LibrarySearch, LibraryState, MediaItem, MediaKind, MediaPreview, Playlist,
  PlaylistDetail, RawAlbum, RawSong, Song,
} from "./types";

const KEY = "eco.session";

interface Session { u: string; t: string; s: string }

function readSession(): Session | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Session | null;
    return saved?.u && saved.t && saved.s ? saved : null;
  } catch {
    return null; // storage unavailable: sign in every time
  }
}

/** Who is signed in. The stored session holds the user + token + salt, never the password. */
export const useSession = create<{ session: Session | null }>(() => ({ session: readSession() }));

const session = () => useSession.getState().session;
export const username = () => session()?.u ?? "";

let candidate: Session | null = null; // the credentials being tried by the sign-in form
let signingIn = false; // while true, a rejected login is a form error, not an expired session

/** The signature never contains the password: t = md5(password + salt). */
export async function signIn(user: string, password: string): Promise<void> {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  candidate = { u: user.trim(), s: salt, t: md5(password + salt) };
  signingIn = true;
  try {
    await subsonic("ping");
    try { localStorage.setItem(KEY, JSON.stringify(candidate)); } catch { /* ignore */ }
    useSession.setState({ session: candidate });
  } finally {
    candidate = null;
    signingIn = false;
  }
}

export function signOut(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  useSession.setState({ session: null });
}

type Param = string | number | string[];

const params = (extra: Record<string, Param> = {}): URLSearchParams => {
  const current = candidate ?? session();
  const out = new URLSearchParams({ u: current?.u ?? "", t: current?.t ?? "", s: current?.s ?? "", v: "1.16.1", c: "eco", f: "json" });
  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) for (const one of value) out.append(key, one);
    else out.set(key, String(value));
  }
  return out;
};

const part = encodeURIComponent;

/** URL of the audio stream. format=raw asks Navidrome not to transcode: you hear the file as it is. */
export const streamUrl = (id: string) => `/rest/stream?${params({ id, format: "raw" })}`;
export const mediaFileUrl = (id: string) => `/api/media/${part(id)}/file?${params()}`;
export const mediaThumbUrl = (id: string) => `/api/media/${part(id)}/thumb?${params()}`;
/** Where a song's or episode's audio comes from. Imported media is served by eco itself, music by Navidrome. */
export const sourceUrl = (song: Song) => (song.mediaId ? mediaFileUrl(song.mediaId) : streamUrl(song.id));
export const coverUrl = (id: string | null | undefined, size = 300) => (id ? `/rest/getCoverArt?${params({ id, size })}` : "");
/** The picture for a song: Navidrome cover art, or the thumbnail of an imported episode. Empty if none. */
export const songCover = (song: Song, size = 300) => (song.mediaId ? mediaThumbUrl(song.mediaId) : coverUrl(song.cover, size));
export const hasCover = (song: Song) => Boolean(song.mediaId || song.cover);
/** A picture the user chose for a playlist. The version makes the browser fetch a new picture when it changes. */
export const playlistCoverUrl = (id: string, version: number) => `/api/covers/playlists/${part(id)}?${params({ cover: version })}`;

/** A request the server answered with an error. `status` tells, for one, that it wants the password first (428). */
export class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, options); } catch { throw new Error("No connection to the server"); }
  if (response.status === 401 && !signingIn) { signOut(); throw new Error("Your session expired"); }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new HttpError(body.error || `Server error ${response.status}`, response.status);
  return body;
}

interface SubsonicBody {
  status: string;
  error?: { code?: number; message?: string };
  [endpoint: string]: unknown;
}

/** Call a Subsonic endpoint and return its response body. */
export async function subsonic(endpoint: string, extra?: Record<string, Param>): Promise<SubsonicBody> {
  const body = (await request<{ "subsonic-response": SubsonicBody }>(`/rest/${endpoint}?${params(extra)}`))["subsonic-response"];
  if (body.status !== "ok") {
    if ((body.error?.code === 40 || body.error?.code === 41) && !signingIn) signOut();
    throw new Error(body.error?.message || "Navidrome returned an error");
  }
  return body;
}

/** Call one of eco's own endpoints. */
export const eco = <T>(path: string, extra?: Record<string, string | number>, method = "GET", signal?: AbortSignal) =>
  request<T>(`/api/${path}?${params(extra)}`, { method, signal });

const send = <T>(path: string, body: BodyInit, method = "POST", type = "application/json") =>
  request<T>(`/api/${path}?${params()}`, { method, body, headers: { "Content-Type": type } });

// ---- Devices of this account controlling each other ----
export const connectEventsUrl = (extra: Record<string, string>) => `/api/connect/events?${params(extra)}`;
export const sendJson = (path: string, extra: Record<string, string>, body: unknown) =>
  request<unknown>(`/api/${path}?${params(extra)}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

// ---- Administrators ----
export const whoAmI = () => eco<{ user: string; admin: boolean; catalog: string; version?: string }>("me");
export interface Account { username: string; name?: string; admin: boolean; last_seen?: string; avatar?: number }
export const listUsers = () => eco<{ locked?: boolean; users?: Account[] }>("admin/users");
// ---- How the app looks, the same on every device ----
export const getLook = () => eco<{ look: unknown; at: number; wallpaper: number }>("me/look");
export const putLook = (look: object) => send<{ at: number }>("me/look", JSON.stringify(look), "PUT");
export const putWallpaper = (picture: Blob) => send<{ wallpaper: number }>("me/wallpaper", picture, "PUT", "image/jpeg");
export const deleteWallpaper = () => eco<{ wallpaper: number }>("me/wallpaper", undefined, "DELETE");
/** The background picture. Its address changes with it, so it can be kept for good. */
export const wallpaperUrl = (version: number) => `/api/me/wallpaper?${params({ v: version })}`;

/** Confirm the administrator's password, which lets Eco use Navidrome's own API for 15 minutes. */
export const unlockAdmin = (password: string) => send<{ unlocked: boolean }>("admin/unlock", JSON.stringify({ password }));
export const userAvatarUrl = (name: string, version: number) => `/api/admin/users/${part(name)}/avatar?${params({ v: version })}`;
export const createUser = (username: string, name: string, password: string) => send<{ username: string }>("admin/users", JSON.stringify({ username, name, password }));
export const getCleanup = () => eco<CleanupReport>("admin/cleanup");
export const removeDuplicate = (keep: string, remove: string[]) => send<{ deleted: string[] }>("admin/cleanup/duplicates", JSON.stringify({ keep, remove }));
export const separateArtists = (names: string[]) => send<CleanupReport["task"]>("admin/cleanup/artists", JSON.stringify({ names }));
/** `purged` is false when the file is gone but Navidrome still lists the song (under Missing Files there). */
export const deleteSong = (id: string) => eco<{ deleted: boolean; file: string; purged: boolean }>(`admin/songs/${part(id)}`, undefined, "DELETE");

// Normalise Subsonic objects into the shape the UI uses everywhere.
export const toSong = (s: RawSong): Song => ({
  id: s.id, title: s.title, artist: readableArtists(s.artist), artistId: s.artistId ?? s.artist_id, album: s.album,
  albumId: s.albumId ?? s.album_id, duration: s.duration, cover: s.coverArt ?? s.cover, starred: s.starred ?? "",
});
export const toAlbum = (a: RawAlbum): Album => ({
  id: a.id, name: a.name, artist: readableArtists(a.artist), artistId: a.artistId ?? a.artist_id,
  cover: a.coverArt ?? a.cover, songCount: a.songCount ?? a.song_count, year: a.year, added: a.created ? Date.parse(a.created) : undefined,
});

export async function getAlbum(id: string): Promise<AlbumDetail> {
  const a = (await subsonic("getAlbum", { id })).album as RawAlbum & { song?: RawSong[] };
  return { ...toAlbum(a), songs: (a.song ?? []).map(toSong) };
}

export async function getArtist(id: string): Promise<ArtistDetail> {
  const a = (await subsonic("getArtist", { id })).artist as { id: string; name: string; coverArt?: string; album?: RawAlbum[] };
  return { id: a.id, name: a.name, cover: a.coverArt, albums: (a.album ?? []).map(toAlbum) };
}

export async function getArtists(): Promise<Artist[]> {
  const list = (await subsonic("getArtists")).artists as { index?: { artist?: { id: string; name: string; coverArt?: string; albumCount?: number }[] }[] };
  return (list.index ?? []).flatMap((group) => group.artist ?? []).map((a) => ({ id: a.id, name: a.name, cover: a.coverArt, albumCount: a.albumCount }));
}

/** The most Navidrome hands over at once. A library can hold far more albums, so they are asked for until none are left. */
const ALBUMS_AT_ONCE = 500;

export async function getAlbums(): Promise<Album[]> {
  const albums: Album[] = [];
  for (let offset = 0; ; offset += ALBUMS_AT_ONCE) {
    const list = (await subsonic("getAlbumList2", { type: "alphabeticalByName", size: ALBUMS_AT_ONCE, offset })).albumList2 as { album?: RawAlbum[] };
    const page = list.album ?? [];
    albums.push(...page.map(toAlbum));
    if (page.length < ALBUMS_AT_ONCE) return albums;
  }
}

export async function getPlaylists(): Promise<Playlist[]> {
  const list = (await subsonic("getPlaylists")).playlists as { playlist?: { id: string; name: string; owner?: string; songCount: number; coverArt?: string; readonly?: boolean; changed?: string }[] };
  return (list.playlist ?? []).map((p) => ({ id: p.id, name: p.name, owner: p.owner, songCount: p.songCount, cover: p.coverArt, readonly: p.readonly, changed: p.changed ? Date.parse(p.changed) : undefined }));
}

export async function getPlaylist(id: string): Promise<PlaylistDetail> {
  const p = (await subsonic("getPlaylist", { id })).playlist as { id: string; name: string; owner?: string; coverArt?: string; readonly?: boolean; entry?: RawSong[] };
  return { id: p.id, name: p.name, owner: p.owner, cover: p.coverArt, readonly: p.readonly, songs: (p.entry ?? []).map(toSong) };
}

/** Every ID travels in the address, and addresses have a limit, so long lists go a part at a time. */
const ADD_AT_ONCE = 150;

export async function addToPlaylist(id: string, songIds: string[]): Promise<void> {
  for (let i = 0; i < songIds.length; i += ADD_AT_ONCE) await subsonic("updatePlaylist", { playlistId: id, songIdToAdd: songIds.slice(i, i + ADD_AT_ONCE) });
}

export async function createPlaylist(name: string, songIds: string[] = []): Promise<string> {
  const { id } = (await subsonic("createPlaylist", { name })).playlist as { id: string };
  await addToPlaylist(id, songIds);
  return id;
}

export const renamePlaylist = (id: string, name: string) => subsonic("updatePlaylist", { playlistId: id, name });
export const removeFromPlaylist = (id: string, index: number) => subsonic("updatePlaylist", { playlistId: id, songIndexToRemove: index });
export const deletePlaylist = (id: string) => subsonic("deletePlaylist", { id });

/** Tell Navidrome a song was played, which feeds "recently played" and "most played". */
export const scrobble = (id: string) => subsonic("scrobble", { id, submission: "true" }).catch(() => undefined);

/** Favourite songs, the most recently favourited first. */
export async function getStarred(): Promise<Song[]> {
  const list = (await subsonic("getStarred2")).starred2 as { song?: RawSong[] };
  return (list.song ?? []).map(toSong).sort((a, b) => ((a.starred ?? "") < (b.starred ?? "") ? 1 : (a.starred ?? "") > (b.starred ?? "") ? -1 : 0));
}
export const star = (id: string) => subsonic("star", { id });
export const unstar = (id: string) => subsonic("unstar", { id });

// ---- Search, downloads ----
/** The library answers at once. What the catalogue adds comes apart, so a slow catalogue never holds the library back. */
export const search = (q: string, signal?: AbortSignal) => eco<LibrarySearch>("search", { q }, "GET", signal);
export const searchExternal = (q: string, signal?: AbortSignal) => eco<ExternalSearch>("search/external", { q }, "GET", signal);
export const getHome = () => eco<HomeResponse>("home");
export const getSongs = (offset: number, limit: number, sort = "added") => eco<{ songs: RawSong[]; total: number; has_more: boolean }>("songs", { offset, limit, sort });
export const discover = (artist: string) => eco<DiscoverResponse>("discover", { artist });
export const lookupArtist = (name: string) => eco<{ id: string; name: string }>("artists/lookup", { name });
/** Every song in the library that names this artist, featured or not, in album order. */
export const artistSongs = async (name: string) => (await eco<{ songs: RawSong[] }>("artists/songs", { name })).songs.map(toSong);
export const requestDownload = (id: string) => eco<Job>("download", { id }, "POST");
export const getJobs = () => eco<Job[]>("jobs");

// ---- Albums in the catalogue ----
export const getCatalogAlbum = (id: string) => eco<CatalogAlbumPage>(`catalog/albums/${part(id)}`);
/** The whole of a library album according to the catalogue, with what is downloaded marked. Null when it does not have it. */
export const matchCatalogAlbum = async (name: string, artist: string): Promise<CatalogAlbumPage | null> => {
  const page = await eco<{ album: ExternalAlbum | null; tracks?: AlbumTrack[] }>("albums/match", { name, artist });
  return page.album ? { album: page.album, tracks: page.tracks ?? [] } : null;
};

// ---- The user's library: recents, pins, playlist covers ----
export const getLibrary = () => eco<LibraryState>("me/library");
export const touchRecent = (entry: LibraryEntry) => send<LibraryState>("me/recents", JSON.stringify(entry));
export const forgetRecent = (entry: LibraryEntry) => eco<LibraryState>(`me/recents/${entry.type}/${part(entry.id)}`, undefined, "DELETE");
export const addPin = (entry: LibraryEntry) => send<LibraryState>("me/pins", JSON.stringify(entry));
export const removePin = (entry: LibraryEntry) => eco<LibraryState>(`me/pins/${entry.type}/${part(entry.id)}`, undefined, "DELETE");
export const uploadPlaylistCover = (id: string, picture: Blob) => send<LibraryState>(`covers/playlists/${part(id)}`, picture, "PUT", "image/jpeg");
export const avatarUrl = (version: number) => `/api/me/avatar?${params({ v: version })}`;
export const uploadAvatar = (picture: Blob) => send<LibraryState>("me/avatar", picture, "PUT", "image/jpeg");
export const deleteAvatar = () => eco<LibraryState>("me/avatar", undefined, "DELETE");
export const deletePlaylistCover = (id: string) => eco<LibraryState>(`covers/playlists/${part(id)}`, undefined, "DELETE");

// ---- Lists of songs imported from a file ----
export const parseImportFile = async (file: File) =>
  (await request<{ lists: ImportedList[] }>(`/api/imports/parse?${params({ name: file.name })}`, { method: "POST", body: file })).lists;
export const saveImport = (name: string, rows: ImportRow[]) => send<ImportDetail>("imports", JSON.stringify({ name, rows }));
export const listImports = async () => (await eco<{ imports: ImportSummary[] }>("imports")).imports;
export const getImport = (id: string) => eco<ImportDetail>(`imports/${part(id)}`);
export const syncImport = (id: string) => eco<ImportDetail>(`imports/${part(id)}/sync`, undefined, "POST");
export const downloadImport = (id: string) => eco<{ queued: number }>(`imports/${part(id)}/download`, undefined, "POST");
export const forgetImport = (id: string) => eco<{ forgotten: boolean }>(`imports/${part(id)}`, undefined, "DELETE");

// ---- Imported audio (podcasts, audiobooks, other) ----
export const KINDS: [MediaKind, string][] = [["podcast", "Podcast"], ["audiobook", "Audiobook"], ["other", "Other"]];
export const kindLabel = (kind?: string) => KINDS.find(([k]) => k === kind)?.[1] ?? "Other";
export const mediaPreview = (url: string) => eco<MediaPreview>("media/preview", { url });
export const mediaImport = (url: string, kind: MediaKind) => eco<Job & { existing?: MediaItem }>("media/import", { url, kind }, "POST");
export const listMedia = async (kind: MediaKind) => (await eco<{ items: MediaItem[] }>("media", { kind })).items;
export const deleteMedia = (id: string) => eco<{ deleted: boolean }>(`media/${part(id)}`, undefined, "DELETE");
/** An imported item shaped like a song, so the same player and rows can handle it. */
export const mediaSong = (item: MediaItem): Song => ({
  id: `m-${item.id}`, mediaId: item.id, title: item.title, artist: item.channel,
  album: kindLabel(item.kind), duration: item.duration, kind: item.kind, size: item.size,
});
