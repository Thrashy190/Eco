// Songs being fetched by the server. Views subscribe per Spotify ID and redraw as the job moves
// from queued → searching → downloading → tagging → ready.
import { eco, mediaImport } from "./api.js";

const jobs = new Map(); // Spotify ID → latest job
const watchers = new Map(); // Spotify ID → Set of callbacks
const finished = new Set();
let timer = null;

const isActive = (job) => job.state !== "ready" && job.state !== "error";
const emit = (id) => watchers.get(id)?.forEach((fn) => fn(jobs.get(id)));

/** Call fn(job) whenever the job for this Spotify ID changes. Returns an unsubscribe function. */
export function watch(spotifyId, fn) {
  if (!watchers.has(spotifyId)) watchers.set(spotifyId, new Set());
  watchers.get(spotifyId).add(fn);
  if (jobs.has(spotifyId)) fn(jobs.get(spotifyId));
  return () => watchers.get(spotifyId)?.delete(fn);
}

export const jobFor = (spotifyId) => jobs.get(spotifyId);

/** Call fn(job) once for each job that becomes ready, so lists can refresh. */
export function onReady(fn) { finished.add(fn); return () => finished.delete(fn); }

/** Ask the server to download a song. */
export async function request(spotifyId) {
  const job = await eco("download", { spotify_id: spotifyId }, "POST");
  jobs.set(spotifyId, job);
  emit(spotifyId);
  poll();
  return job;
}

/** Ask the server to import a YouTube link as a video, podcast, audiobook or other. Returns the job, or {existing}. */
export async function requestMedia(url, kind, format, height) {
  const result = await mediaImport(url, kind, format, height);
  if (result.existing) return result;
  jobs.set(result.spotify_id, result);
  emit(result.spotify_id);
  poll();
  return result;
}

/** Retry a failed song. */
export const retry = request;

async function tick() {
  let list;
  try { list = await eco("jobs"); } catch { return; }
  for (const job of list) {
    const before = jobs.get(job.spotify_id);
    const changed = !before || before.state !== job.state || before.progress !== job.progress || before.library_id !== job.library_id;
    jobs.set(job.spotify_id, job);
    if (changed) {
      emit(job.spotify_id);
      if (job.state === "ready" && before && before.state !== "ready") finished.forEach((fn) => fn(job));
    }
  }
  if (![...jobs.values()].some(isActive)) { clearInterval(timer); timer = null; }
}

/** Start following the server's jobs (also picks up ones started earlier or from another device). */
export function poll() {
  if (!timer) timer = setInterval(tick, 1200);
  tick();
}

/** Number of songs queued or being fetched. */
export const activeCount = () => [...jobs.values()].filter(isActive).length;
