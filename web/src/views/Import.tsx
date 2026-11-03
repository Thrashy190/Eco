// Bringing a list of songs from elsewhere. A file is read, you choose which of its lists to keep, and each becomes a
// real playlist with the songs the library has. Songs it lacks are only downloaded when you ask: a long list takes hours.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { downloadImport, forgetImport, getImport, listImports, parseImportFile, saveImport, syncImport, toSong } from "../lib/api";
import { clock, plural } from "../lib/format";
import type { ImportDetail, ImportedList } from "../lib/types";
import { BackButton, Empty, Section, Skeleton, useIncremental } from "../components/common";
import { Icon, Ring } from "../components/Icon";
import { JobProgress } from "../components/songs";
import { isActive, liveJob, pollJobs, useJobs } from "../stores/downloads";
import * as player from "../stores/player";
import { toast } from "../stores/ui";

function ChooseFile({ onRead, label = "Choose a file", className = "primary" }: { onRead: (lists: ImportedList[]) => void; label?: string; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function read(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try { onRead(await parseImportFile(file)); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Ring percent={-1} size={18} /> : <Icon name="upload" size={18} />}{busy ? "Reading…" : label}
      </button>
      <input ref={input} type="file" accept=".csv,.json,.tsv,.txt,text/csv,application/json" hidden onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ""; }} />
    </>
  );
}

/** Which of the file's lists to bring in. */
function ChooseLists({ lists, onDone }: { lists: ImportedList[]; onDone: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [chosen, setChosen] = useState(() => new Set(lists.map((l) => l.name)));
  const [busy, setBusy] = useState(false);
  const picked = lists.filter((l) => chosen.has(l.name));

  async function bring() {
    setBusy(true);
    try {
      let last: ImportDetail | null = null;
      for (const list of picked) last = await saveImport(list.name, list.rows);
      for (const key of ["imports", "playlists", "playlist"]) void client.invalidateQueries({ queryKey: [key] });
      toast(`Imported ${plural(picked.length, "list")}`);
      if (picked.length === 1 && last) navigate(`/import/${last.id}`); else onDone();
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Section title={`Found ${plural(lists.length, "list")}`}>
      <ul className="rows">
        {lists.map((list) => {
          const on = chosen.has(list.name);
          return (
            <li key={list.name} className="row track selectable" onClick={() => setChosen((now) => { const next = new Set(now); if (on) next.delete(list.name); else next.add(list.name); return next; })}>
              <span className={`tick${on ? " on" : ""}`} role="checkbox" aria-checked={on} aria-label={list.name}>{on && <Icon name="check" size={16} />}</span>
              <div className="text"><b>{list.name}</b><span>{`${plural(list.rows.length, "song")} · ${list.owned} already in your library`}</span></div>
            </li>
          );
        })}
      </ul>
      <div className="actions">
        <button type="button" className="primary" disabled={busy || !picked.length} onClick={() => void bring()}>
          {busy ? <Ring percent={-1} size={20} /> : <Icon name="check" size={20} />}{picked.length === 1 ? "Make this playlist" : `Make ${plural(picked.length, "playlist")}`}
        </button>
        <button type="button" className="pill" onClick={onDone}>Cancel</button>
      </div>
    </Section>
  );
}

export function ImportView() {
  const [lists, setLists] = useState<ImportedList[] | null>(null);
  const { data: imports, isPending } = useQuery({ queryKey: ["imports"], queryFn: listImports });
  return (
    <>
      <BackButton />
      <header className="hero compact"><h1>Import a playlist</h1><p>From a file. It needs no Spotify login or account here.</p></header>
      {lists
        ? <ChooseLists lists={lists} onDone={() => setLists(null)} />
        : (
          <div className="narrow">
            <div className="actions"><ChooseFile onRead={setLists} /></div>
            <div className="group how">
              <div className="setting stack"><div className="label"><b>From Spotify, a playlist right now</b><span>Sites like Exportify or TuneMyMusic make a CSV file of a playlist after you sign in there.</span></div></div>
              <div className="setting stack"><div className="label"><b>From Spotify, everything</b><span>Account → Privacy → Download your data. It takes some days; Playlist1.json holds your playlists and YourLibrary.json your liked songs.</span></div></div>
              <div className="setting stack"><div className="label"><b>From anywhere else</b><span>Any CSV with columns for the song and the artist.</span></div></div>
            </div>
          </div>
        )}
      {isPending && <Skeleton rows={2} />}
      {imports && imports.length > 0 && !lists && (
        <Section title="Imported">
          <ul className="rows">
            {imports.map((list) => (
              <li key={list.id} className="row"><Link className="row-link" to={`/import/${list.id}`}>
                <div className="cover no-cover"><Icon name="queue" size={20} /></div>
                <div className="text"><b>{list.name}</b><span>{`${list.owned} of ${plural(list.total, "song")} in your library`}</span></div>
              </Link></li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

const SECONDS_PER_DOWNLOAD = 40;

export function ImportDetailView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const jobs = useJobs((s) => s.jobs);
  const [newer, setNewer] = useState<ImportedList[] | null>(null);
  const { data, error, isPending } = useQuery({ queryKey: ["import", id], queryFn: () => getImport(id) });

  const refresh = (fresh: ImportDetail) => {
    client.setQueryData(["import", id], fresh);
    for (const key of ["imports", "playlists", "playlist"]) void client.invalidateQueries({ queryKey: [key] });
  };
  // Songs that arrived since the last visit join the playlist
  const sync = useMutation({ mutationFn: () => syncImport(id), onSuccess: refresh, onError: (e: Error) => toast(e.message) });
  useEffect(() => { sync.mutate(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.rows ?? [];
  const { visible, sentinel } = useIncremental(rows);
  if (isPending) return <><BackButton /><Skeleton /></>;
  if (error || !data) return <><BackButton /><Empty>{error?.message ?? "That list was not found"}</Empty></>;

  const missing = rows.filter((r) => !r.library);
  const running = missing.filter((r) => { const job = liveJob(jobs[r.key]); return job && isActive(job); }).length;
  const owned = rows.filter((r) => r.library).map((r) => toSong(r.library!));

  async function fetchMissing() {
    const minutes = Math.ceil((missing.length * SECONDS_PER_DOWNLOAD) / 60);
    if (missing.length > 10 && !confirm(`Download ${plural(missing.length, "song")}? It takes about ${minutes} minutes, one at a time, and goes on while you do something else.`)) return;
    try {
      const { queued } = await downloadImport(id);
      pollJobs();
      toast(`${plural(queued, "song")} on the way`);
    } catch (e) { toast((e as Error).message); }
  }

  return (
    <>
      <BackButton />
      <header className="detail">
        <div className="cover huge no-cover"><Icon name="queue" size={64} /></div>
        <div className="info">
          <h1>{data.name}</h1>
          <p>{`Imported list · ${data.owned} of ${plural(data.total, "song")} in your library`}</p>
        </div>
      </header>
      <div className="actions">
        {owned.length > 0 && <button type="button" className="primary" onClick={() => player.play(owned, 0)}><Icon name="play" size={20} />Play</button>}
        {data.playlist_id && <Link className="pill" to={`/playlist/${data.playlist_id}`}><Icon name="queue" size={16} />Open playlist</Link>}
        {missing.length > 0 && running === 0 && <button type="button" className="pill" onClick={() => void fetchMissing()}><Icon name="download" size={16} />{`Download ${plural(missing.length, "missing song")}`}</button>}
        {running > 0 && <span className="pill"><Ring percent={-1} size={16} />{`${plural(running, "song")} on the way`}</span>}
        <ChooseFile onRead={setNewer} label="Import a newer file" className="pill" />
        <button type="button" className="pill" onClick={async () => {
          if (!confirm(`Forget “${data.name}”? The playlist stays, it just stops being updated from this list.`)) return;
          await forgetImport(id);
          void client.invalidateQueries({ queryKey: ["imports"] });
          navigate("/import", { replace: true });
        }}><Icon name="trash" size={16} />Forget</button>
      </div>
      {newer && <ChooseLists lists={newer} onDone={() => setNewer(null)} />}
      <p className="note">To update it, import a newer file with the same list name: the same playlist follows it. Songs you added to the playlist yourself stay.</p>
      <ul className="rows">
        {visible.map((row, i) => {
          const job = row.library ? undefined : liveJob(jobs[row.key]);
          const failed = job?.state === "error";
          return (
            <li key={`${row.key}-${i}`} className={`row track${row.library ? "" : " not-owned"}`} onClick={row.library ? () => player.play(owned, owned.findIndex((s) => s.id === row.library!.id)) : undefined}>
              <span className="num">{i + 1}</span>
              <div className="text">
                <b>{row.title}</b>
                <span title={job?.error}>{failed ? `Could not download: ${job?.error}` : [row.artist, row.album].filter(Boolean).join(" · ")}</span>
              </div>
              {job && !failed && job.state !== "ready" && <span className="download"><JobProgress state={job.state as "queued"} progress={job.progress} /></span>}
              {job?.state === "ready" && <span className="download"><Ring percent={-1} /></span>}
              {row.library && <span className="status owned-mark" title="In your library"><Icon name="check" size={18} /></span>}
              {row.duration_ms ? <span className="time">{clock(row.duration_ms / 1000)}</span> : null}
            </li>
          );
        })}
      </ul>
      {sentinel}
    </>
  );
}
