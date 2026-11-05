// An album as the catalogue lists it: every track in order, which ones are already downloaded, and a choice of which of
// the others to fetch. Downloaded tracks play; tapping any other track selects it.
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { getCatalogAlbum, matchCatalogAlbum, toSong } from "../lib/api";
import { clock, plural } from "../lib/format";
import type { AlbumTrack, Job, LibraryEntry, Song, CatalogAlbumPage } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { ArtistLinks } from "../components/ArtistLinks";
import { DownloadToggle, PinButton } from "../components/cards";
import { BackButton, DetailPage, Empty, Pill, Section, Skeleton } from "../components/common";
import { Picture } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { JobProgress, PlayButtons, SavedStatus, SongList, songMenu } from "../components/songs";
import { useIsCurrent } from "../stores/connect";
import { isActive, liveJob, requestSong, useJobs } from "../stores/downloads";
import { catalogAlbumEntry, touch } from "../stores/library";
import * as player from "../stores/player";
import { useOnline } from "../stores/settings";
import { toast } from "../stores/ui";

type TrackStatus = "owned" | "busy" | "indexing" | "failed" | "missing";

/** What a track is doing right now. The library has the last word: a job only speaks for songs it does not list yet. */
export function trackStatus(track: AlbumTrack, job: Job | undefined): TrackStatus {
  if (track.library) return "owned";
  if (!job) return "missing";
  if (job.state === "error") return "failed";
  return isActive(job) ? "busy" : "indexing"; // downloaded a moment ago; Navidrome has not listed it yet
}

interface TrackRowProps {
  track: AlbumTrack;
  showArtist: boolean;
  selected: boolean;
  onToggle: () => void;
  onPlay: () => void;
}

function TrackRow({ track, showArtist, selected, onToggle, onPlay }: TrackRowProps) {
  const navigate = useNavigate();
  const job = liveJob(useJobs((s) => s.jobs[track.id]));
  const status = trackStatus(track, job);
  const song = track.library ? toSong(track.library) : null;
  const { current: isCurrent } = useIsCurrent(song?.id);
  const selectable = status === "missing" || status === "failed";
  return (
    <li className={cx(ui.row, status !== "owned" && !selectable && "cursor-default", status !== "owned" && !selectable && "[&>div>b]:text-muted")} data-current={isCurrent || undefined}
      onClick={status === "owned" ? onPlay : selectable ? onToggle : undefined}>
      {selectable
        ? <span className={ui.tick} data-on={selected || undefined} role="checkbox" aria-checked={selected} aria-label={`Download ${track.title}`}>{selected && <Icon name="check" size={16} />}</span>
        : <span className={ui.num}>{track.track}</span>}
      <div className={ui.text}>
        <b>{track.title}</b>
        <span>
          {status === "owned" ? "Downloaded" : status === "indexing" ? "Adding to your library…" : status === "failed" ? "Could not download. Tap to select it and try again." : "Not downloaded"}
          {showArtist ? ` · ${track.artist}` : ""}
        </span>
      </div>
      {status === "busy" && job && <span className={ui.download}><JobProgress state={job.state as "queued"} progress={job.progress} /></span>}
      {status === "indexing" && <span className={ui.download}><Ring percent={-1} /></span>}
      {status === "owned" && song && <SavedStatus id={song.id} />}
      {status === "owned" && <span className={cx(ui.status, "mr-0.5")} title="Downloaded"><Icon name="check" size={18} /></span>}
      <span className={ui.time}>{clock(track.duration)}</span>
      {song && <button className={ui.rowMore} aria-label="More" onClick={(e) => { e.stopPropagation(); songMenu(song, navigate); }}><Icon name="more" size={20} /></button>}
    </li>
  );
}

interface AlbumPageProps {
  art: ReactNode;
  page: CatalogAlbumPage;
  artistId?: string;
  entry: LibraryEntry;
  /** Songs of this album in the library that the catalogue's list does not have. */
  extra?: Song[];
  /** True while a downloaded song waits for Navidrome to list it, so the page should look again soon. */
  onWaiting: (waiting: boolean) => void;
}

/** One album page, however it was reached: from search, from an artist, from the library or from a song. */
export function AlbumPage({ art, page, artistId, entry, extra = [], onWaiting }: AlbumPageProps) {
  const jobs = useJobs((s) => s.jobs);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { album, tracks } = page;
  useEffect(() => {
    onWaiting(tracks.some((t) => trackStatus(t, liveJob(jobs[t.id])) === "indexing"));
  }, [tracks, jobs, onWaiting]);

  const fromTracks = useMemo(() => tracks.filter((t) => t.library).map((t) => toSong(t.library!)), [tracks]);
  const owned = useMemo(() => [...fromTracks, ...extra], [fromTracks, extra]);
  const selectable = tracks.filter((t) => { const s = trackStatus(t, liveJob(jobs[t.id])); return s === "missing" || s === "failed"; });
  const chosen = selectable.filter((t) => selected.has(t.id));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;
  const discs = [...new Set(tracks.map((t) => t.disc))];
  // Keeping an album offline needs one library album to file it under
  const albumIds = new Set(owned.map((s) => s.albumId));
  const libraryAlbum = albumIds.size === 1 ? [...albumIds][0] : undefined;
  const toggle = (trackId: string) => setSelected((now) => {
    const next = new Set(now);
    if (next.has(trackId)) next.delete(trackId); else next.add(trackId);
    return next;
  });

  async function downloadChosen() {
    setSelected(new Set());
    toast(`Downloading ${plural(chosen.length, "song")}`);
    for (const track of chosen) {
      try { await requestSong(track.id); } catch (e) { toast((e as Error).message); break; }
    }
  }

  return (
    <>
      <DetailPage art={art}
        info={(
          <>
            <h1>{album.name}</h1>
            <p><ArtistLinks name={album.artist} id={artistId} />{album.year ? ` · ${album.year}` : ""}</p>
            <p>{`${fromTracks.length} of ${plural(tracks.length, "song")} downloaded`}</p>
          </>
        )}
        actions={owned.length > 0
          ? (
            <PlayButtons songs={owned} from={entry}>
              {libraryAlbum && <DownloadToggle spec={{ id: `album:${libraryAlbum}`, kind: "album", title: album.name, subtitle: album.artist }} songs={owned} />}
              <PinButton entry={entry} />
            </PlayButtons>
          )
          : <div className={ui.actions}><PinButton entry={entry} /></div>}>
      {selectable.length > 0 && (
        <div className={ui.selectBar}>
          <Pill icon={allChosen ? "check" : undefined} onClick={() => setSelected(allChosen ? new Set() : new Set(selectable.map((t) => t.id)))}>
            {allChosen ? "Clear selection" : `Select all ${selectable.length}`}
          </Pill>
          <button className={ui.get} disabled={!chosen.length} onClick={() => void downloadChosen()}>
            <Icon name="download" size={18} />{chosen.length ? `Download ${plural(chosen.length, "song")}` : "Tap songs to choose"}
          </button>
        </div>
      )}
      <ul className={ui.rows}>
        {discs.map((disc) => (
          <Fragment key={disc}>
            {discs.length > 1 && <li className={ui.discTitle}>{`Disc ${disc}`}</li>}
            {tracks.filter((t) => t.disc === disc).map((track) => (
              <TrackRow key={track.id} track={track} showArtist={track.artist !== album.artist} selected={selected.has(track.id)}
                onToggle={() => toggle(track.id)}
                onPlay={() => player.play(owned, owned.findIndex((s) => s.id === track.library?.id), entry)} />
            ))}
          </Fragment>
        ))}
      </ul>
      {extra.length > 0 && <Section title="Also in your library"><SongList songs={extra} hideAlbum from={entry} /></Section>}
      </DetailPage>
    </>
  );
}

export function CatalogAlbumView() {
  const { id = "" } = useParams();
  const online = useOnline();
  const [waiting, setWaiting] = useState(false);
  const { data, error, isPending } = useQuery({
    queryKey: ["catalog-album", id],
    queryFn: () => getCatalogAlbum(id),
    enabled: online,
    refetchInterval: waiting ? 10_000 : false,
  });
  const entry = data ? catalogAlbumEntry(data.album) : null;
  const entryId = entry?.id;
  useEffect(() => { if (entry) touch(entry); }, [entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!online) return <><BackButton /><Empty>Albums you do not have yet need a connection.</Empty></>;
  if (isPending) return <><BackButton /><Skeleton /></>;
  if (error) return <><BackButton /><Empty>{error.message}</Empty></>;
  const artistId = data.tracks.find((t) => t.library && t.artist === data.album.artist)?.library?.artist_id;
  return (
    <>
      <BackButton />
      <AlbumPage art={<Picture src={data.album.cover_url} className={ui.coverHuge} external />} page={data} artistId={artistId} entry={entry!} onWaiting={setWaiting} />
    </>
  );
}

/** An album saved when the catalogue was another one: its name still finds it. */
export function AlbumLookup() {
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";
  const artist = params.get("artist") ?? "";
  const { data, isPending, error } = useQuery({ queryKey: ["album-match", name, artist], queryFn: () => matchCatalogAlbum(name, artist), enabled: Boolean(name && artist) });
  if (data) return <Navigate to={`/catalog-album/${data.album.id}`} replace />;
  if (isPending && name && artist) return <><BackButton /><Skeleton /></>;
  return <><BackButton /><Empty>{error?.message ?? `The catalogue does not have “${name}”. Try searching for it.`}</Empty></>;
}
