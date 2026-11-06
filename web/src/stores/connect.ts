// Playing on another device, like Spotify Connect. Every device of an account keeps a stream open to the server: it
// tells each one which devices exist and what they play, and carries commands between them. The server only ever
// connects devices of the same account (internal/connect).
//
// `target` is the device being controlled, or null when the music plays here. While it is set, the player passes
// controls to that device (setForward), so the rest of the app works the same wherever the music is.
//
// `chosen` says whether the user picked that device. A device can also end up merely watching another one because music
// started there; then tapping a song plays it right here. Sending it away unasked meant tapping a song did nothing, when
// the other device was a forgotten tab, a phone asleep, or a browser that refuses to start without a tap of its own.
import { create } from "zustand";
import { connectEventsUrl, sendJson } from "../lib/api";
import { deviceName } from "../lib/format";
import type { Song } from "../lib/types";
import * as player from "./player";
import { toast } from "./ui";

export interface DeviceStatus {
  song: Song | null;
  playing: boolean;
  position: number;
  length: number;
  volume: number;
  speed: number;
  shuffle: boolean;
  repeat: player.Repeat;
  index: number;
  upcoming: Song[];
  source?: string; // the album or playlist playing, when known
  autoplay?: boolean;
  blocked: boolean;
}

export interface Device {
  id: string;
  name: string;
  can_volume: boolean;
  state?: DeviceStatus | null;
}

interface ConnectState {
  connected: boolean;
  devices: Device[];
  target: string | null;
  chosen: boolean;
  /** When each device's state arrived, to work out its position since then. */
  heardAt: Record<string, number>;
}

export const useConnect = create<ConnectState>(() => ({ connected: false, devices: [], target: null, chosen: false, heardAt: {} }));
const state = () => useConnect.getState();

// One ID per tab, not per browser: two tabs are two places music can play.
function makeDeviceId(): string {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const saved = sessionStorage.getItem("eco.device.id");
    if (saved) return saved;
    sessionStorage.setItem("eco.device.id", id);
  } catch { /* storage unavailable: a new device each time */ }
  return id;
}
export const selfId = makeDeviceId();

const NAME_KEY = "eco.device.name";
export function myDeviceName(): string {
  try { return localStorage.getItem(NAME_KEY) || deviceName(navigator.userAgent); } catch { return deviceName(navigator.userAgent); }
}

const device = (id: string | null) => state().devices.find((d) => d.id === id);
export const nameOf = (id: string | null) => device(id)?.name ?? "another device";

// ---- Talking to the server ----

const send = (target: string, action: string, value?: unknown) =>
  sendJson("connect/command", { device: selfId }, { target, action, value });

/** Stop controlling a device that is gone or does not answer. */
function dropTarget(id: string, message: string): void {
  if (state().target !== id) return;
  useConnect.setState({ target: null, chosen: false });
  player.syncTime();
  toast(message);
}

async function command(target: string, action: string, value?: unknown): Promise<void> {
  try {
    await send(target, action, value);
  } catch {
    dropTarget(target, `${nameOf(target)} is not available. Music stays on this device.`);
  }
}

/** A sleeping phone can look connected for a while. A device that heard a command reports back within a moment. */
const ANSWERS = new Set(["load", "resume", "toggle", "next", "jump"]);
let answerTimer: ReturnType<typeof setTimeout> | undefined;
function expectAnswer(target: string): void {
  const sentAt = Date.now();
  clearTimeout(answerTimer);
  answerTimer = setTimeout(() => {
    if ((state().heardAt[target] ?? 0) < sentAt) dropTarget(target, `${nameOf(target)} is not answering. Music stays on this device.`);
  }, 6000);
}

let lastReported = "";
async function report(force = false): Promise<void> {
  const status = player.localStatus();
  // The position moves all the time: only that changing is no news, the periodic report covers it. A song dragged
  // to another place in the queue is news, so the order counts, not only the length
  const fingerprint = JSON.stringify({ ...status, position: 0, upcoming: status.upcoming.map((s) => (s.queued ? "+" : "") + s.id).join(" ") });
  if (!force && fingerprint === lastReported) return;
  lastReported = fingerprint;
  await sendJson("connect/state", { device: selfId }, status).catch(() => undefined);
}

// ---- Who plays ----

let startedAt = 0; // when playback last started or moved here
const startedHere = () => { startedAt = Date.now(); };
const sinceStart = () => Date.now() - startedAt;
const SAME_MOMENT_MS = 1000; // two devices starting this close together have not heard of each other yet
const SETTLED_MS = 3000; // by now, a device still saying it plays has heard that this one started

function follow(id: string): void {
  if (state().target === id) return;
  if (player.usePlayer.getState().playing) player.applyCommand("pause", undefined);
  useConnect.setState({ target: id, chosen: false });
}

// What each device was last known to be doing. Only a device *starting* to play takes over: its regular "still playing"
// reports must not stop music that started here since, or two devices keep pausing each other.
const wasPlaying = new Map<string, boolean>();

/**
 * Only one device plays at a time: when another starts, this one stops and shows what plays there. Two devices starting
 * at the same moment each hear of the other, and stopping both would leave silence, so the higher ID keeps playing. The
 * same rule settles two devices that still both play once the news has had time to arrive.
 */
function onPeerStatus(id: string, status: DeviceStatus | null | undefined): void {
  const playing = Boolean(status?.playing);
  const started = playing && !wasPlaying.get(id);
  wasPlaying.set(id, playing);
  const since = sinceStart();
  const theyWin = id > selfId;
  if (started && (since >= SAME_MOMENT_MS || theyWin)) { follow(id); return; }
  if (playing && theyWin && since >= SETTLED_MS && player.usePlayer.getState().playing) { follow(id); return; }
  if (state().target === id && status?.blocked) toast(`${nameOf(id)} needs a tap on its screen to start playing`);
}

/** A device that stopped reporting long ago is asleep or gone, whatever its last report said. */
const STILL_PLAYING_MS = 60_000;

/** When the list of devices changes: notice who left and, if nothing plays here, show what plays elsewhere. */
function settleTarget(ages: Map<string, number>): void {
  const { target, devices } = state();
  const others = devices.filter((d) => d.id !== selfId);
  if (target && !others.some((d) => d.id === target)) {
    dropTarget(target, `${nameFromMemory(target)} disconnected`);
    return;
  }
  // Someone joining is no reason to stop what plays here: only a device starting to play is (onPeerStatus)
  if (target || player.usePlayer.getState().playing || sinceStart() < SETTLED_MS) return;
  const playing = others.find((d) => d.state?.playing && (ages.get(d.id) ?? 0) < STILL_PLAYING_MS);
  if (playing) follow(playing.id);
}

const known = new Map<string, string>();
const nameFromMemory = (id: string) => known.get(id) ?? "The other device";

// ---- Moving playback ----

/** Move what plays here to another device, and stop here. */
async function moveTo(id: string): Promise<void> {
  const from = player.handoff();
  if (from) {
    player.applyCommand("pause", undefined);
    await report(true); // told first, so the other device does not mistake this one for still playing
    await command(id, "resume", from);
    expectAnswer(id);
  }
  useConnect.setState({ target: id === selfId ? null : id });
  player.syncTime();
}

/** Choose where the music plays. Works from any device, including one that is not playing. */
export async function selectDevice(id: string): Promise<void> {
  const { target } = state();
  const source = target ?? selfId;
  if (id === source) return;
  startedHere();
  if (source === selfId) {
    await moveTo(id);
  } else {
    if (device(source)?.state?.song) await command(source, "transfer", id);
    useConnect.setState({ target: id === selfId ? null : id });
    player.syncTime();
  }
  useConnect.setState({ chosen: id !== selfId });
}

function onCommand(action: string, value: unknown): void {
  if (action === "transfer") {
    startedHere();
    void moveTo(String(value));
    return;
  }
  if (action === "resume") {
    startedHere();
    useConnect.setState({ target: null, chosen: false });
  }
  player.applyCommand(action, value);
}

// ---- The volume slider sends many values per second: only the latest counts ----

let pendingVolume: number | null = null;
let volumeTimer: ReturnType<typeof setTimeout> | undefined;
function sendVolume(target: string, value: number): void {
  pendingVolume = value;
  patchDevice(target, { volume: value }); // the slider must follow the finger, not the network
  if (volumeTimer) return;
  volumeTimer = setTimeout(() => {
    volumeTimer = undefined;
    if (pendingVolume !== null) void command(target, "volume", pendingVolume);
    pendingVolume = null;
  }, 120);
}

function patchDevice(id: string, change: Partial<DeviceStatus>): void {
  useConnect.setState((s) => ({
    devices: s.devices.map((d) => (d.id === id && d.state ? { ...d, state: { ...d.state, ...change } } : d)),
    heardAt: "position" in change ? { ...s.heardAt, [id]: Date.now() } : s.heardAt,
  }));
}

// ---- The position of a device far away is worked out here ----

function remotePosition(id: string): { position: number; length: number } | null {
  const { heardAt } = state();
  const status = device(id)?.state;
  if (!status) return null;
  const elapsed = status.playing ? ((Date.now() - (heardAt[id] ?? Date.now())) / 1000) * (status.speed || 1) : 0;
  return { position: Math.min(status.position + elapsed, status.length || Infinity), length: status.length };
}

// ---- Starting and stopping ----

let stream: EventSource | null = null;
let stopReports: (() => void) | null = null;

export function startConnect(): () => void {
  player.setForward((action, value) => {
    const { target, chosen } = state();
    if (!target) return false;
    // Tapping a song while only watching another device means "play this here"
    if (action === "load" && !chosen) {
      startedHere();
      useConnect.setState({ target: null });
      player.syncTime();
      return false;
    }
    if (action === "volume") { sendVolume(target, Number(value)); return true; }
    if (action === "seek") patchDevice(target, { position: Number(value) });
    void command(target, action, value);
    if (ANSWERS.has(action)) expectAnswer(target);
    return true;
  });

  stream = new EventSource(connectEventsUrl({ device: selfId, name: myDeviceName(), can_volume: player.canSetVolume ? "1" : "0" }));
  stream.onopen = () => {
    useConnect.setState({ connected: true });
    lastReported = "";
    void report(true);
  };
  stream.onerror = () => useConnect.setState({ connected: false }); // the browser reconnects by itself
  stream.addEventListener("devices", (e) => {
    const list = JSON.parse((e as MessageEvent<string>).data) as (Device & { age_ms?: number })[];
    const now = Date.now();
    const heardAt: Record<string, number> = {};
    for (const d of list) {
      heardAt[d.id] = now - (d.age_ms ?? 0);
      known.set(d.id, d.name);
    }
    const ages = new Map(list.map((d) => [d.id, d.age_ms ?? 0]));
    for (const d of list) if (d.id !== selfId) wasPlaying.set(d.id, Boolean(d.state?.playing));
    useConnect.setState({ devices: list.sort((a, b) => a.name.localeCompare(b.name)), heardAt });
    settleTarget(ages);
  });
  stream.addEventListener("state", (e) => {
    const { device: id, state: status } = JSON.parse((e as MessageEvent<string>).data) as { device: string; state: DeviceStatus };
    useConnect.setState((s) => ({
      devices: s.devices.map((d) => (d.id === id ? { ...d, state: status } : d)),
      heardAt: { ...s.heardAt, [id]: Date.now() },
    }));
    onPeerStatus(id, status);
  });
  stream.addEventListener("command", (e) => {
    const { action, value } = JSON.parse((e as MessageEvent<string>).data) as { action: string; value: unknown };
    onCommand(action, value);
  });

  // Tell the others what happens here: right away on any change, and now and then so positions stay close
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = player.usePlayer.subscribe(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void report(), 150);
  });
  const audio = document.getElementById("audio") as HTMLAudioElement;
  const onSeeked = () => void report(true);
  audio.addEventListener("seeked", onSeeked);
  // Sound starting here, by whatever means (a lock-screen button, a tapped song), means here is where it plays now
  const onPlay = () => {
    startedHere();
    if (state().target) { useConnect.setState({ target: null, chosen: false }); player.syncTime(); }
  };
  audio.addEventListener("play", onPlay);
  const heartbeat = setInterval(() => { if (player.usePlayer.getState().playing) void report(true); }, 15_000);
  // While controlling another device, its position drives the progress bar here
  const ticker = setInterval(() => {
    const { target } = state();
    const at = target && remotePosition(target);
    if (at) player.useTime.setState(at);
  }, 500);

  stopReports = () => {
    unsubscribe();
    clearTimeout(debounce);
    clearInterval(heartbeat);
    clearInterval(ticker);
    audio.removeEventListener("seeked", onSeeked);
    audio.removeEventListener("play", onPlay);
    clearTimeout(answerTimer);
  };

  return stopConnect;
}

export function stopConnect(): void {
  stream?.close();
  stream = null;
  stopReports?.();
  stopReports = null;
  player.setForward(null);
  wasPlaying.clear();
  useConnect.setState({ connected: false, devices: [], target: null, chosen: false, heardAt: {} });
  player.syncTime();
}

/** Rename this device. It appears under the new name after reconnecting. */
export function renameDevice(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
    else localStorage.removeItem(NAME_KEY);
  } catch { /* storage unavailable */ }
  if (stream) { stopConnect(); startConnect(); }
}

// ---- What the screens read ----

/** What the player should show: this device, or the one being controlled. */
export function useShown() {
  const target = useConnect((s) => s.target);
  const remote = useConnect((s) => s.devices.find((d) => d.id === s.target));
  const song = player.useCurrentSong();
  const local = player.usePlayer();
  if (target && remote?.state) {
    const s = remote.state;
    return { song: s.song, playing: s.playing, shuffle: s.shuffle, repeat: s.repeat, speed: s.speed, volume: s.volume, upcoming: s.upcoming, source: s.source ?? "", autoplay: Boolean(s.autoplay), index: s.index, loading: false,
      canVolume: remote.can_volume, deviceName: remote.name, isRemote: true };
  }
  if (target) {
    return { song: null, playing: false, shuffle: false, repeat: "off" as const, speed: 1, volume: 1, upcoming: [] as Song[], source: "", autoplay: false, index: -1, loading: false,
      canVolume: remote?.can_volume ?? false, deviceName: remote?.name ?? "", isRemote: true };
  }
  return { song, playing: local.playing, shuffle: local.shuffle, repeat: local.repeat, speed: local.speed, volume: local.volume,
    upcoming: local.queue.slice(local.index + 1, local.index + 51), source: local.source, autoplay: local.autoplay, index: local.index, loading: local.loading, canVolume: player.canSetVolume, deviceName: "", isRemote: false };
}

/** Whether a song is the one playing, wherever that is. */
export function useIsCurrent(id: string | undefined): { current: boolean; playing: boolean } {
  const target = useConnect((s) => s.target);
  const remote = useConnect((s) => (s.target ? s.devices.find((d) => d.id === s.target)?.state : null));
  const localId = player.usePlayer((s) => s.queue[s.index]?.id);
  const localPlaying = player.usePlayer((s) => s.playing);
  const current = Boolean(id) && (target ? remote?.song?.id : localId) === id;
  return { current, playing: current && (target ? Boolean(remote?.playing) : localPlaying) };
}
