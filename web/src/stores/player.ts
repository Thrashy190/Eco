// The player: queue, playback, volume, lock-screen controls and play counts. It lives outside React, around the
// <audio> element in index.html, so music never stops because a screen changed. The UI reads usePlayer and useTime.
import { create } from "zustand";
import { hasCover, scrobble, songCover, sourceUrl, streamUrl } from "../lib/api";
import * as order from "../lib/queue";
import type { LibraryEntry, Song } from "../lib/types";
import { touch } from "./library";
import * as offline from "./offline";
import { isOnline, settings } from "./settings";
import { toast } from "./ui";

export type Repeat = "off" | "all" | "one";

interface PlayerState {
  queue: Song[]; // songs in play order; the ones added by hand are marked `queued` (lib/queue.ts)
  index: number;
  source: string; // the name of the album or playlist playing, when known: the queue says what comes next from it
  shuffle: boolean;
  repeat: Repeat;
  playing: boolean;
  speed: number;
  volume: number; // 0–1
  blocked: boolean; // the browser refused to start playing until someone taps the screen
  loading: boolean; // asked to play and no sound yet: without showing it, a slow start looks like the app froze
}

/** Everything another device needs to take over playback. */
export interface Handoff {
  queue: Song[];
  index: number;
  source?: string;
  position: number;
  playing: boolean;
  shuffle: boolean;
  repeat: Repeat;
}

/**
 * When playback happens on another device, every control below is passed there instead of acting here (see
 * stores/connect.ts). Screens call the same functions either way and never need to know where the music is.
 */
type Forward = (action: string, value?: unknown) => boolean;
let forward: Forward | null = null;
let applying = false; // running a command from another device: it must act here, not be passed on
export const setForward = (fn: Forward | null) => { forward = fn; };
const remote = (action: string, value?: unknown) => !applying && (forward?.(action, value) ?? false);

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

const readNumber = (key: string): number | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null || !Number.isFinite(Number(raw)) ? null : Number(raw);
  } catch {
    return null;
  }
};
const remember = (key: string, value: number) => { try { localStorage.setItem(key, String(value)); } catch { /* ignore */ } };

const audio = document.getElementById("audio") as HTMLAudioElement;

export const usePlayer = create<PlayerState>(() => ({
  queue: [], index: -1, source: "", shuffle: false, repeat: "off", playing: false, blocked: false, loading: false,
  speed: SPEEDS.includes(readNumber("eco.speed") ?? 1) ? readNumber("eco.speed") ?? 1 : 1,
  volume: Math.min(Math.max(readNumber("eco.volume") ?? 1, 0), 1),
}));
/** Position changes many times a second: kept apart so only what shows it redraws. */
export const useTime = create<{ position: number; length: number }>(() => ({ position: 0, length: 0 }));

const state = () => usePlayer.getState();
export const current = (): Song | null => state().queue[state().index] ?? null;
export const useCurrentSong = (): Song | null => usePlayer((s) => s.queue[s.index] ?? null);
/** Spoken-word items (podcasts, audiobooks…) remember where you stopped and can play faster. */
export const isSpoken = (song: Song | null) => Boolean(song?.kind);

/**
 * iPhones and iPads ignore audio.volume (only the hardware buttons change it), so the slider is hidden there rather
 * than shown doing nothing. Asking the system by name is on purpose: a real iPhone reads the value back as if it had
 * worked. iPads describe themselves as Macs, but Macs have no touch screen.
 */
export const canSetVolume = !/iPhone|iPad|iPod/.test(navigator.userAgent) && !(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
audio.volume = state().volume;

export function setVolume(volume: number): void {
  const value = Math.min(Math.max(volume, 0), 1);
  if (remote("volume", value)) return;
  audio.volume = value;
  usePlayer.setState({ volume: value });
  remember("eco.volume", value);
}

const applySpeed = () => { const rate = isSpoken(current()) ? state().speed : 1; audio.defaultPlaybackRate = rate; audio.playbackRate = rate; };
export function cycleSpeed(): void {
  if (remote("speed")) return;
  const speed = SPEEDS[(SPEEDS.indexOf(state().speed) + 1) % SPEEDS.length];
  usePlayer.setState({ speed });
  remember("eco.speed", speed);
  applySpeed();
}

const posKey = (id: string) => `eco.pos.${id}`;
export const savedPosition = (id: string) => readNumber(posKey(id)) ?? 0;
const savePosition = (id: string, seconds: number) => remember(posKey(id), Math.floor(seconds));
export const clearPosition = (id: string) => { try { localStorage.removeItem(posKey(id)); } catch { /* ignore */ } };

let objectUrl: string | null = null;
let scrobbled = false;
let lastSaved = 0;
let loadSerial = 0;

// ---- The next song waits on this device ----
// Going to the next song used to leave seconds of silence while it arrived through the tunnel. Once a song is playing,
// the following one is fetched into memory, so it starts at once. It works on iPhones too, which ignore preload hints.

const PREPARE_AFTER = 2500; // a song skipped straight away should not cost the next one's download
const MAX_PREPARED = 40 * 1024 * 1024; // enough for any song; long audio just streams

let prepared: { id: string; url: string } | null = null;
let preparing: { id: string; stop: AbortController } | null = null;
let prepareTimer: ReturnType<typeof setTimeout> | undefined;

const saveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

function forgetPrepared(): void {
  preparing?.stop.abort();
  preparing = null;
  if (prepared) { URL.revokeObjectURL(prepared.url); prepared = null; }
}

function prepareNext(): void {
  const { queue, index, repeat } = state();
  const song = queue[index + 1] ?? (repeat === "all" ? queue[0] : undefined);
  if (!song || song.mediaId || offline.isSaved(song.id) || !isOnline() || saveData()) return;
  if (prepared?.id === song.id || preparing?.id === song.id || song.id === current()?.id) return;
  forgetPrepared();
  const job = { id: song.id, stop: new AbortController() };
  preparing = job;
  fetch(streamUrl(song.id), { signal: job.stop.signal })
    .then((response) => {
      if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_PREPARED) throw new Error("not worth keeping");
      return response.blob();
    })
    .then((blob) => { if (preparing === job) prepared = { id: song.id, url: URL.createObjectURL(blob) }; })
    .catch(() => undefined) // it simply streams when its turn comes
    .finally(() => { if (preparing === job) preparing = null; });
}

function mixed<T>(list: T[]): T[] {
  const out = list.slice();
  for (let k = out.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [out[k], out[j]] = [out[j], out[k]];
  }
  return out;
}

/** The next song may have changed: fetch that one ahead instead, once the current one has been heard a moment. */
function nextChanged(): void {
  if (!audio.paused && audio.currentTime * 1000 >= PREPARE_AFTER) prepareNext();
}

/**
 * Play a list of songs starting at position i. `from` is the album or playlist it belongs to, for the Recent view and
 * the queue. Songs added to the queue by hand and not played yet stay, right after the first song.
 */
export function play(songs: Song[], i = 0, from?: LibraryEntry, source = from?.name ?? ""): void {
  if (from) touch(from);
  if (remote("load", { songs, index: i, source })) return;
  const list = state().shuffle ? [songs[i], ...mixed(songs.filter((_, k) => k !== i))] : songs;
  usePlayer.setState({ ...order.startList(state(), list, state().shuffle ? 0 : i), source });
  void load();
}

/** Play the songs shuffled from a random start. */
export function playShuffled(songs: Song[], from?: LibraryEntry): void {
  if (!songs.length) return;
  const start = Math.floor(Math.random() * songs.length);
  if (remote("load", { songs, index: start, shuffle: true, source: from?.name ?? "" })) { if (from) touch(from); return; }
  usePlayer.setState({ shuffle: true });
  play(songs, start, from);
}

export function playNext(song: Song): void {
  if (remote("play_next", song)) { toast("Playing next"); return; }
  if (!current()) return play([song]);
  usePlayer.setState(order.addNext(state(), song));
  nextChanged();
  toast("Playing next");
}

export function enqueue(song: Song): void {
  if (remote("enqueue", song)) { toast("Added to the queue"); return; }
  if (!current()) return play([song]);
  usePlayer.setState(order.addToQueue(state(), song));
  nextChanged();
  toast("Added to the queue");
}

/** Drag a song that has not played yet to another place in the queue (positions in the whole queue). */
export function moveInQueue(from: number, to: number): void {
  if (remote("move", { from, to })) return;
  const before = state();
  const after = order.move(before, from, to);
  if (after === before) return;
  usePlayer.setState(after);
  nextChanged();
}

async function load(startAt = 0, autoplay = true): Promise<void> {
  const song = current();
  if (!song) return;
  const serial = ++loadSerial; // skipping quickly must not let an older song win the race
  scrobbled = false;
  usePlayer.setState({ loading: autoplay });
  clearTimeout(prepareTimer);
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  if (prepared?.id === song.id) { objectUrl = prepared.url; prepared = null; } else forgetPrepared();
  // A song saved on this device plays from storage, with no request to the server. If that copy would not play and there
  // is a connection, the second try streams it (see the error listener)
  if (!objectUrl && offline.isSaved(song.id) && (retried !== song.id || !isOnline())) {
    const saved = await offline.audioUrl(song.id).catch(() => null);
    if (serial !== loadSerial) { if (saved) URL.revokeObjectURL(saved); return; }
    objectUrl = saved;
  }
  audio.src = objectUrl ?? sourceUrl(song);
  applySpeed();
  // A position handed over from another device wins; otherwise spoken audio picks up where you left off
  const at = startAt > 0 ? startAt : isSpoken(song) ? savedPosition(song.id) : 0;
  if (at > 5 || startAt > 0) audio.addEventListener("loadedmetadata", () => { if (serial === loadSerial && at < audio.duration - (startAt > 0 ? 1 : 10)) audio.currentTime = at; }, { once: true });
  if (autoplay) start();
  updateMediaSession(song);
}

function start(): void {
  audio.play().catch((e: DOMException) => {
    if (e.name !== "NotAllowedError") return;
    usePlayer.setState({ blocked: true, loading: false }); // whoever asked from another device needs to know
    toast("Tap play to start");
  });
}

export function toggle(): void {
  if (remote("toggle")) return;
  if (audio.paused) start(); else audio.pause();
}
export function pause(): void {
  if (remote("pause")) return;
  audio.pause();
}

export function next(auto = false): void {
  if (!auto && remote("next")) return;
  const { repeat, index, queue } = state();
  if (repeat === "one" && auto) { audio.currentTime = 0; void audio.play(); return; }
  if (index + 1 < queue.length) usePlayer.setState({ index: index + 1 });
  else if (repeat === "all" && queue.length) usePlayer.setState({ index: 0 });
  else { audio.pause(); audio.currentTime = 0; return; }
  void load();
}

export function previous(): void {
  if (remote("previous")) return;
  const { index } = state();
  if (audio.currentTime > 3 || index === 0) { audio.currentTime = 0; return; }
  usePlayer.setState({ index: index - 1 });
  void load();
}

export function jumpTo(i: number): void {
  if (remote("jump", i)) return;
  usePlayer.setState(order.jump(state(), i));
  void load();
}
export function seek(seconds: number): void {
  if (remote("seek", seconds)) return;
  audio.currentTime = Math.max(0, seconds);
}
export function toggleShuffle(): void {
  if (remote("shuffle")) return;
  const { shuffle } = state();
  if (!shuffle && current()) { usePlayer.setState(order.shuffleUpcoming(state(), mixed)); nextChanged(); }
  usePlayer.setState({ shuffle: !shuffle });
}
export function cycleRepeat(): void {
  if (remote("repeat")) return;
  const { repeat } = state();
  usePlayer.setState({ repeat: repeat === "off" ? "all" : repeat === "all" ? "one" : "off" });
}

const length = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current()?.duration ?? 0);

/** What this device is playing, as other devices see it. */
export const localStatus = () => {
  const { queue, index, source, playing, shuffle, repeat, speed, volume, blocked } = state();
  return {
    song: queue[index] ?? null, playing, shuffle, repeat, speed, volume, blocked, index, source,
    position: audio.currentTime || 0, length: length(), upcoming: queue.slice(index + 1, index + 31),
  };
};

/** Everything needed to continue on another device, or null when nothing is loaded here. */
export function handoff(): Handoff | null {
  const { queue, index, source, playing, shuffle, repeat } = state();
  return queue[index] ? { queue, index, source, position: audio.currentTime || 0, playing, shuffle, repeat } : null;
}

/** Carry on from where another device stopped. */
function adopt(from: Handoff): void {
  usePlayer.setState({ queue: from.queue, index: from.index, source: from.source ?? "", shuffle: from.shuffle, repeat: from.repeat });
  void load(from.position, from.playing);
}

/** Do what another of this user's devices asked. Values come from the same account, but stay data: nothing here runs them. */
export function applyCommand(action: string, value: unknown): void {
  applying = true;
  try {
    switch (action) {
      case "load": {
        const { songs, index, shuffle, source } = value as { songs: Song[]; index: number; shuffle?: boolean; source?: string };
        if (shuffle) usePlayer.setState({ shuffle: true });
        play(songs, index, undefined, typeof source === "string" ? source : "");
        break;
      }
      case "resume": adopt(value as Handoff); break;
      case "toggle": toggle(); break;
      case "pause": pause(); break;
      case "next": next(); break;
      case "previous": previous(); break;
      case "seek": seek(Number(value)); break;
      case "jump": jumpTo(Number(value)); break;
      case "volume": setVolume(Number(value)); break;
      case "speed": cycleSpeed(); break;
      case "shuffle": toggleShuffle(); break;
      case "repeat": cycleRepeat(); break;
      case "play_next": playNext(value as Song); break;
      case "enqueue": enqueue(value as Song); break;
      case "move": {
        const { from, to } = value as { from: number; to: number };
        moveInQueue(Number(from), Number(to));
        break;
      }
    }
  } finally {
    applying = false;
  }
}

/** Put the progress bar back on this device's own position. */
export const syncTime = () => useTime.setState({ position: audio.currentTime || 0, length: length() });

/** A song no longer exists: take it out of the queue, moving on if it was playing. */
export function forgetSong(id: string): void {
  const { queue, index } = state();
  if (!queue.some((s) => s.id === id)) return;
  const playingIt = queue[index]?.id === id;
  const before = queue.slice(0, index).filter((s) => s.id !== id).length;
  const rest = queue.filter((s) => s.id !== id);
  if (!playingIt) { usePlayer.setState({ queue: rest, index: before }); return; }
  audio.pause();
  audio.removeAttribute("src");
  if (before < rest.length) { usePlayer.setState({ queue: rest, index: before }); void load(); return; }
  usePlayer.setState({ queue: [], index: -1, source: "" });
}

audio.addEventListener("play", () => usePlayer.setState({ playing: true, blocked: false }));
audio.addEventListener("playing", () => {
  failedInARow = 0;
  retried = "";
  usePlayer.setState({ loading: false });
  clearTimeout(prepareTimer);
  prepareTimer = setTimeout(prepareNext, PREPARE_AFTER);
});
audio.addEventListener("waiting", () => { if (!audio.paused) usePlayer.setState({ loading: true }); });
audio.addEventListener("canplay", () => { if (audio.paused) usePlayer.setState({ loading: false }); });
audio.addEventListener("pause", () => {
  usePlayer.setState({ playing: false, loading: false });
  const song = current();
  if (song && isSpoken(song) && audio.currentTime > 5) savePosition(song.id, audio.currentTime);
});
audio.addEventListener("ended", () => { const song = current(); if (song && isSpoken(song)) clearPosition(song.id); next(true); });

// A failure is usually the connection, not the song. Try once more, in case it was a moment's trouble or a prepared copy
// this browser could not read (the second try streams). Then move on, but a dead connection must not race through the
// whole playlist: stop after a few songs in a row.
let retried = "";
let failedInARow = 0;
audio.addEventListener("error", () => {
  if (!audio.getAttribute("src")) return;
  usePlayer.setState({ loading: false });
  const song = current();
  if (!song) return;
  if (retried !== song.id) {
    retried = song.id;
    void load(audio.currentTime || 0);
    return;
  }
  failedInARow += 1;
  if (failedInARow >= 3 || state().queue.length < 2) {
    failedInARow = 0;
    toast("Could not play. Check your connection");
    return;
  }
  toast("Could not play that song");
  next(true);
});
audio.addEventListener("timeupdate", () => {
  const song = current();
  const total = length();
  // Count a play once half the song (or 30 s) has been heard: this feeds "Recently played"
  if (!scrobbled && song && !isSpoken(song) && total > 0 && audio.currentTime > Math.min(total / 2, 30)) {
    scrobbled = true;
    if (isOnline() && settings().scrobble) void scrobble(song.id);
  }
  if (song && isSpoken(song) && Math.abs(audio.currentTime - lastSaved) >= 5) { lastSaved = audio.currentTime; savePosition(song.id, audio.currentTime); }
  useTime.setState({ position: audio.currentTime, length: total });
  if ("mediaSession" in navigator && navigator.mediaSession.setPositionState && total > 0) {
    try { navigator.mediaSession.setPositionState({ duration: total, position: Math.min(audio.currentTime, total), playbackRate: audio.playbackRate }); } catch { /* out of range */ }
  }
});

let sessionCover: string | null = null;

function updateMediaSession(song: Song): void {
  if (!("mediaSession" in navigator)) return;
  const show = (src: string | null, size: number) => {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title, artist: song.artist, album: song.album || "",
      artwork: src ? [{ src, sizes: `${size}x${size}`, type: "image/jpeg" }] : [],
    });
  };
  const fromServer = () => show(hasCover(song) && isOnline() ? songCover(song, 512) : null, 512);
  if (sessionCover) { URL.revokeObjectURL(sessionCover); sessionCover = null; }
  if (!offline.isSaved(song.id)) { fromServer(); return; }
  // A song on this device brings its own picture to the lock screen
  show(null, 0);
  void offline.savedCoverUrl(song.id).then((url) => {
    if (current()?.id !== song.id) { if (url) URL.revokeObjectURL(url); return; }
    if (!url) { fromServer(); return; }
    sessionCover = url;
    show(url, 400);
  });
}

if ("mediaSession" in navigator) {
  const session = navigator.mediaSession;
  session.setActionHandler("play", () => void audio.play());
  session.setActionHandler("pause", () => audio.pause());
  session.setActionHandler("nexttrack", () => next());
  session.setActionHandler("previoustrack", previous);
  session.setActionHandler("seekto", (d) => seek(d.seekTime ?? 0));
  session.setActionHandler("seekbackward", (d) => seek(audio.currentTime - (d.seekOffset || 10)));
  session.setActionHandler("seekforward", (d) => seek(audio.currentTime + (d.seekOffset || 10)));
}
