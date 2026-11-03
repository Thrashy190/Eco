// The player: queue, playback, lock-screen controls and play counts.
import { sourceUrl, songCover, hasCover, scrobble } from "./api.js";
import * as offline from "./store.js";
import { toast } from "./ui.js";
import * as settings from "./settings.js";

const audio = document.getElementById("audio");
const changeListeners = new Set(); // track / play-state / queue changed
const timeListeners = new Set(); // position moved

let queue = []; // songs in play order
let index = -1;
let shuffle = false;
let repeat = "off"; // off | all | one
let scrobbled = false;
let objectUrl = null;

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];
let speedIndex = Math.max(0, SPEEDS.indexOf(Number(localStorage.getItem("eco.speed")) || 1));
export const speed = () => SPEEDS[speedIndex];
export function cycleSpeed() {
  speedIndex = (speedIndex + 1) % SPEEDS.length;
  try { localStorage.setItem("eco.speed", String(speed())); } catch { /* ignore */ }
  applySpeed();
  changed();
}
const applySpeed = () => { const rate = isSpoken(current()) ? speed() : 1; audio.defaultPlaybackRate = rate; audio.playbackRate = rate; };

const posKey = (id) => `eco.pos.${id}`;
export const savedPosition = (id) => { try { return Number(localStorage.getItem(posKey(id))) || 0; } catch { return 0; } };
const savePosition = (id, seconds) => { try { localStorage.setItem(posKey(id), String(Math.floor(seconds))); } catch { /* ignore */ } };
const clearPosition = (id) => { try { localStorage.removeItem(posKey(id)); } catch { /* ignore */ } };
let lastSaved = 0;

export const onChange = (fn) => { changeListeners.add(fn); return () => changeListeners.delete(fn); };
export const onTime = (fn) => { timeListeners.add(fn); return () => timeListeners.delete(fn); };
const changed = () => changeListeners.forEach((fn) => fn());

export const current = () => queue[index] ?? null;
/** Spoken-word items (podcasts, audiobooks…) remember where you stopped and can play faster. */
export const isSpoken = (song) => Boolean(song?.kind);
export const indexOfCurrent = () => index;
export const upcoming = () => queue.slice(index + 1);
export const isPlaying = () => !audio.paused;
export const state = () => ({ shuffle, repeat });
export const position = () => audio.currentTime;
export const length = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current()?.duration ?? 0);

/** Play a list of songs starting at position i. */
export function play(songs, i = 0) {
  queue = songs.slice();
  if (shuffle) shuffleRest(i);
  index = shuffle ? 0 : i;
  load();
}

/** Play the songs shuffled from a random start. */
export function playShuffled(songs) {
  shuffle = true;
  play(songs, Math.floor(Math.random() * songs.length));
}

export function playNext(song) {
  if (!current()) return play([song]);
  queue.splice(index + 1, 0, song);
  toast("Playing next");
  changed();
}

export function enqueue(song) {
  if (!current()) return play([song]);
  queue.push(song);
  toast("Added to the queue");
  changed();
}

function shuffleRest(startAt) {
  const first = queue[startAt];
  const rest = queue.filter((_, k) => k !== startAt);
  for (let k = rest.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [rest[k], rest[j]] = [rest[j], rest[k]];
  }
  queue = [first, ...rest];
}

async function load() {
  const song = current();
  if (!song) return;
  scrobbled = false;
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  // A song saved on this device plays from storage: no network needed
  if (offline.isSaved(song.id)) objectUrl = await offline.audioUrl(song.id).catch(() => null);
  audio.src = objectUrl ?? sourceUrl(song);
  applySpeed();
  if (isSpoken(song)) { // pick up where you left off
    const at = savedPosition(song.id);
    if (at > 5) audio.addEventListener("loadedmetadata", () => { if (at < audio.duration - 10) audio.currentTime = at; }, { once: true });
  }
  audio.play().catch((e) => { if (e.name === "NotAllowedError") toast("Tap play to start"); });
  updateMediaSession(song);
  changed();
}

export const toggle = () => (audio.paused ? audio.play() : audio.pause());
export const pause = () => audio.pause();

export function next(auto = false) {
  if (repeat === "one" && auto) { audio.currentTime = 0; audio.play(); return; }
  if (index + 1 < queue.length) index++;
  else if (repeat === "all" && queue.length) index = 0;
  else { audio.pause(); audio.currentTime = 0; changed(); return; }
  load();
}

export function previous() {
  if (audio.currentTime > 3 || index === 0) { audio.currentTime = 0; return; }
  index--;
  load();
}

export function jumpTo(i) { index = i; load(); }
export function seek(seconds) { audio.currentTime = Math.max(0, seconds); }
export function toggleShuffle() { shuffle = !shuffle; if (shuffle && current()) { const keep = queue.slice(0, index + 1); queue = keep.concat(shuffleTail(queue.slice(index + 1))); } changed(); }
export function cycleRepeat() { repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off"; changed(); }

function shuffleTail(list) {
  const out = list.slice();
  for (let k = out.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [out[k], out[j]] = [out[j], out[k]];
  }
  return out;
}

audio.addEventListener("play", changed);
audio.addEventListener("pause", changed);
audio.addEventListener("ended", () => { if (isSpoken(current())) clearPosition(current().id); next(true); });
audio.addEventListener("pause", () => { const song = current(); if (isSpoken(song) && audio.currentTime > 5) savePosition(song.id, audio.currentTime); });
audio.addEventListener("error", () => {
  if (!audio.src) return;
  toast("Could not play that song");
  if (queue.length > 1) next();
});
audio.addEventListener("timeupdate", () => {
  const len = length();
  // Count a play once half the song (or 30 s) has been heard: this feeds "Recently played"
  if (!scrobbled && current() && !isSpoken(current()) && audio.currentTime > Math.min(len / 2, 30) && len > 0) {
    scrobbled = true;
    if (settings.online() && settings.get().scrobble) scrobble(current().id);
  }
  if (isSpoken(current()) && Math.abs(audio.currentTime - lastSaved) >= 5) { lastSaved = audio.currentTime; savePosition(current().id, audio.currentTime); }
  timeListeners.forEach((fn) => fn(audio.currentTime, len));
  if ("mediaSession" in navigator && navigator.mediaSession.setPositionState && len > 0) {
    try { navigator.mediaSession.setPositionState({ duration: len, position: Math.min(audio.currentTime, len), playbackRate: audio.playbackRate }); } catch { /* out of range */ }
  }
});

function updateMediaSession(song) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title, artist: song.artist, album: song.album || "",
    artwork: hasCover(song) ? [{ src: songCover(song, 512), sizes: "512x512", type: "image/jpeg" }] : [],
  });
}

if ("mediaSession" in navigator) {
  const session = navigator.mediaSession;
  session.setActionHandler("play", () => audio.play());
  session.setActionHandler("pause", () => audio.pause());
  session.setActionHandler("nexttrack", () => next());
  session.setActionHandler("previoustrack", previous);
  session.setActionHandler("seekto", (d) => seek(d.seekTime));
  session.setActionHandler("seekbackward", (d) => seek(audio.currentTime - (d.seekOffset || 10)));
  session.setActionHandler("seekforward", (d) => seek(audio.currentTime + (d.seekOffset || 10)));
}
