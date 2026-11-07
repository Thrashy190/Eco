// For administrators: copies of the same song, artists that are really several people, and albums with no cover or
// doubtful tags. eco proposes; nothing happens until an administrator asks, and the server checks again that they may.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { coverUrl, getCleanup, removeDuplicate, searchExternal, separateArtists, setAlbumCover } from "../lib/api";
import { clock, plural } from "../lib/format";
import { blobToBase64, pictureToCover } from "../lib/image";
import type { AlbumIssue, CleanupReport, DuplicateSong } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { BackButton, Empty, Section, Skeleton, useIncremental } from "../components/common";
import { Picture } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { DELETE_REASON, SONG_LISTS, withPassword } from "../stores/admin";
import { toast } from "../stores/ui";

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

function DuplicateCard({ group, onDone }: { group: CleanupReport["duplicates"][number]; onDone: () => void }) {
  const [keep, setKeep] = useState(group.keep);
  const [busy, setBusy] = useState(false);
  const others: DuplicateSong[] = group.songs.filter((s) => s.id !== keep);

  async function remove() {
    const kept = group.songs.find((s) => s.id === keep)!;
    if (!confirm(`Keep “${kept.title}” from ${kept.album} and delete ${plural(others.length, "other copy", "other copies")} for everyone?\n\nThe file is erased from the server. Your favorite and your playlists move to the copy that stays; other people's stay on the deleted copy and are lost.`)) return;
    setBusy(true);
    try {
      if (await withPassword(() => removeDuplicate(keep, others.map((s) => s.id)), DELETE_REASON) === null) { setBusy(false); return; }
      toast("Deleted");
      onDone();
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-3 mb-3.5 pt-1.5 pb-0.5 rounded-card shadow-[inset_0_0_0_1px_var(--line)] wide:mx-8 wide:bg-glass-strong">
      <ul className={ui.rows}>
        {group.songs.map((song) => (
          <li key={song.id} className={ui.row} onClick={() => setKeep(song.id)}>
            <span className={cx(ui.tick, "rounded-full")} data-on={song.id === keep || undefined} role="radio" aria-checked={song.id === keep} aria-label={`Keep the copy from ${song.album}`}>{song.id === keep && <Icon name="check" size={16} />}</span>
            <Picture src={coverUrl(song.cover, 96)} />
            <div className={ui.text}>
              <b>{song.title}</b>
              <span>{`${song.artist} · ${song.album}`}</span>
              <span>{[clock(song.duration), megabytes(song.size), song.starred && "favorite"].filter(Boolean).join(" · ")}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className={ui.actionsPlain}>
        <button type="button" className={cx(ui.pill, "text-danger")} disabled={busy} onClick={() => void remove()}>
          {busy ? <Ring percent={-1} size={16} /> : <Icon name="trash" size={16} />}{`Keep the selected, delete ${others.length === 1 ? "the other" : `the other ${others.length}`}`}
        </button>
      </div>
    </div>
  );
}

function Artists({ report, onStart }: { report: CleanupReport; onStart: () => void }) {
  const { artists, task } = report;
  const [chosen, setChosen] = useState(() => new Set(artists.filter((a) => a.sure).map((a) => a.name)));
  const { visible, sentinel } = useIncremental(artists, 60);
  const picked = useMemo(() => artists.filter((a) => chosen.has(a.name)), [artists, chosen]);
  const songs = picked.reduce((sum, a) => sum + a.songs, 0);

  async function start() {
    if (!confirm(`Separate ${plural(picked.length, "artist name")} in ${plural(songs, "song")}?\n\nOnly the artist tags change, and a copy of every file is kept first. Songs keep their favorites and playlists, but an album whose artist changes counts as a new one: pins and downloads of that album need doing again.`)) return;
    try { await separateArtists(picked.map((a) => a.name)); onStart(); } catch (e) { toast((e as Error).message); }
  }

  return (
    <Section title={`Artists to separate (${artists.length})`}>
      <p className={ui.note}>“Bad Bunny, Chuwi” counts as one artist in Navidrome. Separated, each one gets their own page. Names with no proof they are two people, such as “Tyler, The Creator”, start unticked.</p>
      {task.running
        ? <div className={ui.actions}><span className={ui.pill}><Ring percent={task.total ? (task.done / task.total) * 100 : -1} size={18} />{`${task.done} of ${plural(task.total, "song")}…`}</span></div>
        : artists.length > 0 && (
          <div className={ui.selectBar}>
            <button type="button" className={ui.pill} onClick={() => setChosen(picked.length === artists.length ? new Set() : new Set(artists.map((a) => a.name)))}>{picked.length === artists.length ? "Clear selection" : "Select all"}</button>
            <button type="button" className={ui.get} disabled={!picked.length} onClick={() => void start()}><Icon name="check" size={18} />{`Separate ${picked.length} (${plural(songs, "song")})`}</button>
          </div>
        )}
      {task.backup && !task.running && task.total > 0 && <p className={ui.note}>{`Last run: ${task.done - (task.failed?.length ?? 0)} of ${plural(task.total, "song")} done. The original files are in ${task.backup}.`}</p>}
      {(task.failed?.length ?? 0) > 0 && <ul className={cx(ui.note, "grid gap-1 text-danger!")}>{task.failed!.slice(0, 20).map((f, i) => <li key={i}>{`${f.title}: ${f.error}`}</li>)}</ul>}
      <ul className={ui.rows}>
        {visible.map((artist) => {
          const on = chosen.has(artist.name);
          return (
            <li key={artist.name} className={ui.row} onClick={() => setChosen((now) => { const next = new Set(now); if (on) next.delete(artist.name); else next.add(artist.name); return next; })}>
              <span className={ui.tick} data-on={on || undefined} role="checkbox" aria-checked={on} aria-label={artist.name}>{on && <Icon name="check" size={16} />}</span>
              <div className={ui.text}><b>{artist.parts.join("  ·  ")}</b><span>{`${plural(artist.songs, "song")}${artist.sure ? "" : " · check this one: it may be one name"}`}</span></div>
            </li>
          );
        })}
      </ul>
      {sentinel}
    </Section>
  );
}

/** Pictures the catalogue has for an album, and one of the person's own, to give an album with no cover. */
function CoverFinder({ issue, onDone }: { issue: AlbumIssue; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const found = useQuery({ queryKey: ["album-search", issue.name, issue.artist], queryFn: ({ signal }) => searchExternal(`${issue.name} ${issue.artist}`, signal), retry: false, staleTime: 5 * 60_000 });
  const options = (found.data?.external_albums ?? []).filter((a) => a.cover_url).slice(0, 8);

  async function save(from: { catalog: string } | { picture: string }) {
    setBusy(true);
    try {
      await setAlbumCover(issue.id, from);
      toast("Cover added");
      onDone();
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }
  async function pick(file: File) {
    try { await save({ picture: await blobToBase64(await pictureToCover(file)) }); } catch (e) { toast((e as Error).message); }
  }

  return (
    <div className="grid gap-2.5 px-3.5 pb-3">
      {found.isPending && <div className="flex items-center gap-2 text-muted text-[.88rem]"><Ring percent={-1} size={16} />Looking in the catalogue…</div>}
      {!found.isPending && options.length === 0 && <p className="text-muted text-[.88rem]">The catalogue has no picture for it. Choose one of your own.</p>}
      {options.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3">
          {options.map((a) => (
            <button key={a.id} type="button" disabled={busy} className="tap grid gap-1 text-left disabled:opacity-50 [&>b]:truncate [&>b]:text-[.82rem] [&>span]:truncate [&>span]:text-[.75rem] [&>span]:text-muted"
              onClick={() => { if (confirm(`Use the cover of “${a.name}” by ${a.artist} for “${issue.name}”?`)) void save({ catalog: a.id }); }}>
              <Picture src={a.cover_url} external className={ui.coverBig} />
              <b>{a.name}</b><span>{[a.artist, a.year].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
      <label className={cx(ui.pill, "justify-self-start cursor-pointer", busy && "opacity-50 pointer-events-none")}>
        <Icon name="image" size={16} />Choose a picture
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
      </label>
    </div>
  );
}

function AlbumIssueCard({ issue, onDone }: { issue: AlbumIssue; onDone: () => void }) {
  const navigate = useNavigate();
  const [finding, setFinding] = useState(false);
  const noCover = issue.problems.some((p) => p.code === "no_cover");
  return (
    <div className="mx-3 mb-3.5 pt-1.5 pb-0.5 rounded-card shadow-[inset_0_0_0_1px_var(--line)] wide:mx-8 wide:bg-glass-strong">
      <ul className={ui.rows}>
        <li className={ui.row} onClick={() => navigate(`/album/${issue.id}`)}>
          <Picture src={noCover ? "" : coverUrl(issue.cover, 96)} />
          <div className={ui.text}><b>{issue.name || "No album name"}</b><span>{[issue.artist, issue.year, plural(issue.songs, "song")].filter(Boolean).join(" · ")}</span></div>
          <span className="text-muted inline-flex rotate-180"><Icon name="back" size={18} /></span>
        </li>
      </ul>
      <ul className="grid gap-1 px-4 pb-2.5 text-[.88rem]">
        {issue.problems.map((p) => <li key={p.code} className="flex gap-2 items-baseline"><span className="size-1.5 flex-none rounded-full bg-accent translate-y-[-2px]" />{p.text}</li>)}
      </ul>
      {noCover && !finding && <div className={ui.actionsPlain}><button type="button" className={ui.pill} onClick={() => setFinding(true)}><Icon name="image" size={16} />Find a cover</button></div>}
      {finding && <CoverFinder issue={issue} onDone={onDone} />}
    </div>
  );
}

const PROBLEM_FILTERS: [string, string][] = [["all", "All"], ["no_cover", "No cover"], ["tags", "Tags"], ["split", "Split albums"]];

function Albums({ albums, onChange }: { albums: AlbumIssue[]; onChange: () => void }) {
  const [filter, setFilter] = useState("all");
  const [done, setDone] = useState<Set<string>>(new Set());
  const shown = albums.filter((a) => !done.has(a.id) && (
    filter === "all" || a.problems.some((p) => (filter === "tags" ? p.code !== "no_cover" && p.code !== "split" : p.code === filter))));
  const { visible, sentinel } = useIncremental(shown, 40);
  return (
    <Section title={`Albums to check (${albums.length - done.size})`}>
      <p className={ui.note}>Albums with no cover, and tags that make an album look wrong: no year, missing or repeated track numbers, titles that still say “(Official Video)”, or one album shown twice because its songs disagree. Eco can add a missing cover; the tags are yours to fix, in a tag editor such as MusicBrainz Picard.</p>
      <div className={ui.segments} role="group" aria-label="Show">
        {PROBLEM_FILTERS.map(([value, label]) => <button key={value} type="button" className={ui.segment} data-on={filter === value || undefined} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      {shown.length === 0
        ? <Empty>{filter === "all" ? "Every album has a cover and its tags look right." : "Nothing of this kind."}</Empty>
        : visible.map((issue) => <AlbumIssueCard key={issue.id} issue={issue} onDone={() => { setDone((now) => new Set(now).add(issue.id)); onChange(); }} />)}
      {sentinel}
    </Section>
  );
}

export function Cleanup() {
  const client = useQueryClient();
  const [polling, setPolling] = useState(false);
  const { data, error, isPending, refetch } = useQuery({ queryKey: ["cleanup"], queryFn: getCleanup, refetchInterval: polling ? 1500 : false });
  const running = data?.task.running ?? false;
  useEffect(() => {
    setPolling(running);
    if (!running) for (const key of SONG_LISTS) void client.invalidateQueries({ queryKey: [key] });
  }, [running, client]);
  // Navidrome can take a moment to stop listing a deleted song, and the copy is already gone from the disk
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const groupKey = (group: CleanupReport["duplicates"][number]) => group.songs.map((s) => s.id).sort().join();
  const groups = data?.duplicates.filter((group) => !handled.has(groupKey(group))) ?? [];
  const changed = (group: CleanupReport["duplicates"][number]) => {
    setHandled((now) => new Set(now).add(groupKey(group)));
    setTimeout(() => void refetch(), 4000);
    for (const key of SONG_LISTS) void client.invalidateQueries({ queryKey: [key] });
  };

  return (
    <>
      <BackButton />
      <header className={ui.heroCompact}><h1>Library clean-up</h1><p>{data ? `${plural(data.songs, "song")} checked` : "Checking your library…"}</p></header>
      {isPending && <Skeleton />}
      {error && <Empty>{error.message}</Empty>}
      {data && (
        <div className={ui.narrow}>
          <Section title={`Songs you have twice (${groups.length})`}>
            {groups.length === 0
              ? <Empty>No duplicates. Same title and artist, and about the same length, is what counts as one.</Empty>
              : groups.map((group) => <DuplicateCard key={groupKey(group)} group={group} onDone={() => changed(group)} />)}
          </Section>
          <Artists report={data} onStart={() => { setPolling(true); void refetch(); }} />
          {data.albums && <Albums albums={data.albums} onChange={() => { for (const key of ["albums", "album", "home"]) void client.invalidateQueries({ queryKey: [key] }); }} />}
        </div>
      )}
    </>
  );
}
