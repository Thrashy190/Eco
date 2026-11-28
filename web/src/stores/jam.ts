// Being in a Jam: listening together with people on this server (internal/jam on the server). The server keeps the
// Jam's time; this device measures how far its clock is from the server's, loads the Jam's queue into the player, and
// every second checks it plays where the Jam is, jumping when it has drifted. The player's controls go to the Jam
// while in one (player.setJamForward), so pausing, skipping or adding a song changes it for everyone.
import { create } from "zustand";
import * as api from "../lib/api";
import { clockOffset, jamPosition, offBeat, type Ping } from "../lib/jamclock";
import type { JamSettings, JamView, Song } from "../lib/types";
import { here, setJamForward } from "./player";
import { toast } from "./ui";

interface JamState {
  view: JamView | null;
  /** Off: this device shows the Jam and controls it, but plays nothing (people listening in one room). */
  listenHere: boolean;
}

export const useJam = create<JamState>(() => ({ view: null, listenHere: true }));
export const useInJam = () => useJam((s) => s.view !== null);

const PINGS = 5;
const ALIGN_EVERY = 1000;
/** After a jump, give the audio time to settle before judging it again: a stalled stream would jump forever. */
const SETTLE_MS = 3000;
/** A song ending here a moment before the server notices is no reason to go back to it. */
const END_SLACK = 1.5;

let offset = 0;
let stream: EventSource | null = null;
let aligner: ReturnType<typeof setInterval> | undefined;
let lastJump = 0;

const serverNow = () => Date.now() + offset;
/** The server's clock, as far as this device can tell. */
export const jamServerNow = serverNow;
const songOf = (entry: JamView["queue"][number]): Song => api.toSong(entry.song);

async function measureClock(): Promise<void> {
  const pings: Ping[] = [];
  for (let i = 0; i < PINGS; i++) {
    const sent = Date.now();
    try {
      const { now } = await api.serverTime();
      pings.push({ sent, server: now, received: Date.now() });
    } catch { /* a lost ping says nothing */ }
  }
  if (pings.length) offset = clockOffset(pings);
}

/** Play here what the Jam plays, from where it is by now. */
function align(): void {
  const { view, listenHere } = useJam.getState();
  if (!view || !listenHere || here.loading()) return;
  const p = view.playback;
  const entry = view.queue[view.current];
  if (!p.entry || !entry) {
    if (!here.paused()) here.pause();
    return;
  }
  const expected = jamPosition(p, serverNow());
  const song = songOf(entry);
  if (here.index() !== view.current || here.songId() !== song.id) {
    // This device moved on by itself a moment before the server did: wait for the server
    const ahead = here.index() === view.current + 1 && song.duration && expected > song.duration - END_SLACK;
    if (!ahead) { here.load(view.queue.map(songOf), view.current, expected, !p.paused); lastJump = Date.now(); }
    return;
  }
  if (p.paused) {
    if (!here.paused()) here.pause();
    if (offBeat(here.position(), expected)) here.seek(expected);
    return;
  }
  if (here.paused()) here.play();
  if (Date.now() - lastJump > SETTLE_MS && offBeat(here.position(), expected)) {
    here.seek(expected);
    lastJump = Date.now();
  }
}

/** An answer cut short arrives as {} (lib/api.ts): only a whole Jam is used. */
const isJamView = (v: unknown): v is JamView =>
  typeof v === "object" && v !== null && typeof (v as JamView).id === "string" && Array.isArray((v as JamView).queue) && typeof (v as JamView).playback === "object";

function apply(view: JamView): void {
  if (!isJamView(view)) return;
  const before = useJam.getState().view;
  if (before && before.id === view.id && view.rev < before.rev) return; // an older answer arriving late
  useJam.setState({ view });
  if (useJam.getState().listenHere && here.index() === view.current && here.songId() === view.queue[view.current]?.song.id) {
    here.setQueue(view.queue.map(songOf)); // the same song plays on; only what comes next changed
  }
  align();
}

/** Do something to the Jam; what comes back is the Jam after it. */
async function act(run: (id: string) => Promise<JamView>): Promise<boolean> {
  const id = useJam.getState().view?.id;
  if (!id) return false;
  try {
    apply(await run(id));
    return true;
  } catch (e) {
    toast((e as Error).message);
    return false;
  }
}

/** Add songs of the library to the Jam: at the end, or right after what plays. */
export async function addSongs(songs: Song[], next = false): Promise<void> {
  const music = songs.filter((s) => !s.mediaId).slice(0, 500);
  if (!music.length) { toast("Only songs of the library can go in a Jam"); return; }
  const added = await act((id) => api.addToJam(id, music.map((s) => s.id), next));
  if (added) toast(music.length === 1 ? (next ? "Playing next in the Jam" : "Added to the Jam") : `Added ${music.length} songs to the Jam`);
}

export const control = (action: string, value = 0, entry = "") => act((id) => api.controlJam(id, action, value, entry));
export const removeEntry = (entry: string) => act((id) => api.removeFromJam(id, entry));
export const moveEntry = (entry: string, to: number) => act((id) => api.moveInJam(id, entry, to));
export const configure = (settings: JamSettings) => act((id) => api.configureJam(id, settings));
export const invite = (users: string[]) => act((id) => api.inviteToJam(id, users));

/** The player's controls, while in a Jam. Volume, speed and the sleep timer stay this device's. */
function forward(action: string, value?: unknown): boolean {
  const view = useJam.getState().view;
  if (!view) return false;
  switch (action) {
    case "load": {
      const { songs, index } = value as { songs: Song[]; index: number };
      const song = songs[index];
      if (song) void addSongs([song]);
      return true;
    }
    case "play_next": void addSongs([value as Song], true); return true;
    case "enqueue": void addSongs([value as Song]); return true;
    case "toggle": void control(view.playback.paused || !view.playback.entry ? "play" : "pause"); return true;
    case "pause": void control("pause"); return true;
    case "next": case "previous": void control(action); return true;
    case "seek": void control("seek", Number(value)); return true;
    case "jump": {
      const entry = view.queue[Number(value)];
      if (entry) void control("jump", 0, entry.id);
      return true;
    }
    case "move": {
      const { from, to } = value as { from: number; to: number };
      const entry = view.queue[Number(from)];
      if (entry) void moveEntry(entry.id, Number(to));
      return true;
    }
    case "shuffle": case "repeat": case "autoplay":
      toast("A Jam plays its queue in order");
      return true;
    // Podcasts and audiobooks' controls: a Jam's position is the server's, so a skip is a seek from where it is now
    case "skip": void control("seek", Math.max(0, here.position() + Number(value))); return true;
    case "chapter": void control(Number(value) < 0 ? "previous" : "next"); return true;
    case "speed": case "set_speed":
      toast("A Jam plays at normal speed");
      return true;
    default:
      return false;
  }
}

function stop(message?: string): void {
  stream?.close();
  stream = null;
  clearInterval(aligner);
  setJamForward(null);
  useJam.setState({ view: null });
  if (message) toast(message);
}

/** Follow a Jam this person is in: its stream, its clock and its controls. */
async function follow(view: JamView): Promise<void> {
  if (!isJamView(view)) throw new Error("The Jam did not arrive whole. Try again");
  stop();
  useJam.setState({ view });
  setJamForward(forward);
  await measureClock();
  if (useJam.getState().view?.id !== view.id) return; // left while measuring
  stream = new EventSource(api.jamEventsUrl(view.id));
  stream.addEventListener("jam", (e) => apply(JSON.parse((e as MessageEvent<string>).data) as JamView));
  stream.addEventListener("ended", () => stop("The Jam has ended"));
  stream.addEventListener("left", () => stop());
  aligner = setInterval(align, ALIGN_EVERY);
  align();
}

export async function startJam(settings: JamSettings): Promise<JamView | null> {
  try {
    const view = await api.createJam(settings);
    await follow(view);
    return view;
  } catch (e) {
    toast((e as Error).message);
    return null;
  }
}

export async function enterJam(id: string): Promise<boolean> {
  try {
    await follow(await api.joinJam(id));
    return true;
  } catch (e) {
    toast((e as Error).message);
    return false;
  }
}

/** Leave the Jam; the host leaving ends it for everyone. The music here goes on from where it was. */
export async function exitJam(): Promise<void> {
  const view = useJam.getState().view;
  if (!view) return;
  try {
    const { ended } = await api.leaveJam(view.id);
    stop(ended ? "The Jam has ended" : "You left the Jam");
  } catch (e) { toast((e as Error).message); }
}

/** The host ends the Jam for everyone. */
export async function finishJam(): Promise<void> {
  const view = useJam.getState().view;
  if (!view) return;
  try {
    await api.endJam(view.id);
    stop("The Jam has ended");
  } catch (e) { toast((e as Error).message); }
}

/** Play the Jam here, or only follow and control it. */
export function setListenHere(listenHere: boolean): void {
  useJam.setState({ listenHere });
  if (!listenHere) here.pause();
  else align();
}

/** The app opening: someone still in a Jam goes back into it. */
export async function resumeJam(): Promise<void> {
  try {
    const { mine } = await api.listJams();
    if (mine && !useJam.getState().view) await follow(await api.getJam(mine));
  } catch { /* the Jam can be joined again from People */ }
}
