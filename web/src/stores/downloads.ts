// Songs being fetched by the server. Screens read a job by its key (a catalogue ID, media:<video id> or import:<hash>) and
// redraw as it moves from queued → searching → downloading → tagging → ready.
import { create } from "zustand";
import { getJobs, mediaImport, requestDownload } from "../lib/api";
import { queryClient } from "../lib/query";
import type { Job, MediaKind } from "../lib/types";

export const useJobs = create<{ jobs: Record<string, Job> }>(() => ({ jobs: {} }));

export const isActive = (job: Job) => job.state !== "ready" && job.state !== "error";

/**
 * A finished job is history, not state: the server keeps jobs for an hour, and the song may have been deleted
 * since. Only a job that finished moments ago still says something about the song.
 */
export function liveJob(job: Job | undefined, now = Date.now()): Job | undefined {
  if (job?.state === "ready" && (job.finished_at ?? 0) * 1000 < now - 2 * 60_000) return undefined;
  return job;
}

let timer: ReturnType<typeof setInterval> | null = null;

function store(job: Job): void {
  useJobs.setState((state) => ({ jobs: { ...state.jobs, [job.key]: job } }));
}

/** What a finished download can change on screen: anything listing songs. */
function refreshAfterDownload(job: Job): void {
  if (job.kind) {
    void queryClient.invalidateQueries({ queryKey: ["media"] });
    return;
  }
  for (const key of ["home", "songs", "search", "catalog-album", "album", "artist", "import", "imports", "playlist", "playlists"]) void queryClient.invalidateQueries({ queryKey: [key] });
}

async function tick(): Promise<void> {
  let list: Job[];
  try { list = await getJobs(); } catch { return; }
  const { jobs } = useJobs.getState();
  const next = { ...jobs };
  for (const job of list) {
    const before = jobs[job.key];
    next[job.key] = job;
    if (job.state === "ready" && before && before.state !== "ready") refreshAfterDownload(job);
  }
  useJobs.setState({ jobs: next });
  if (!Object.values(next).some(isActive) && timer) { clearInterval(timer); timer = null; }
}

/** Start following the server's jobs (also picks up ones started earlier or from another device). */
export function pollJobs(): void {
  if (!timer) timer = setInterval(() => void tick(), 1200);
  void tick();
}

/** Ask the server to download a song. */
export async function requestSong(catalogId: string): Promise<Job> {
  const job = await requestDownload(catalogId);
  store(job);
  pollJobs();
  return job;
}

/** Ask the server to import the audio of a YouTube link. Returns the job, or {existing} if it was imported before. */
export async function requestMedia(url: string, kind: MediaKind) {
  const result = await mediaImport(url, kind);
  if (result.existing) return result;
  store(result);
  pollJobs();
  return result;
}
