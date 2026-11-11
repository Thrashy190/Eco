// Song rows: songs in the library and songs in the catalogue that can be downloaded.
import type { NavigateFunction } from "react-router";
import { useNavigate } from "react-router";
import { clock } from "../lib/format";
import { toSong } from "../lib/api";
import { queryClient } from "../lib/query";
import type { ExternalSong, LibraryEntry, LibraryState, Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { liveJob, requestSong, useJobs } from "../stores/downloads";
import { deleteSongForEveryone, isAdmin } from "../stores/admin";
import { useIsCurrent } from "../stores/connect";
import { isStarred, toggleFavorite } from "../stores/favorites";
import { isPinned, songEntry, togglePin } from "../stores/library";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { removeOffline, saveOffline, useSaving } from "../stores/saving";
import { isOnline, useSettings } from "../stores/settings";
import { openAddToPlaylist } from "../stores/playlists";
import { openSheet, toast, type SheetItem } from "../stores/ui";
import { artistTargets } from "./ArtistLinks";
import { Tile } from "./cards";
import { Picture, SongCover } from "./Cover";
import { Icon, Ring } from "./Icon";
import { useIncremental } from "./common";

export function songMenu(song: Song, navigate: NavigateFunction, extra: SheetItem[] = []): void {
  const starred = isStarred(song);
  const saved = offline.isSaved(song.id);
  const isMusic = !song.mediaId; // favorites and pins are for songs in the library
  const pins = queryClient.getQueryData<LibraryState>(["me", "library"])?.pins ?? [];
  const pinned = isPinned(pins, songEntry(song));
  openSheet(song.title, song.artist, [
    isMusic && { icon: starred ? "heart-fill" : "heart", label: starred ? "Remove from favorites" : "Add to favorites", run: () => void toggleFavorite(song) },
    isMusic && isOnline() && { icon: pinned ? "pin-fill" : "pin", label: pinned ? "Unpin from your library" : "Pin to your library", run: () => void togglePin(songEntry(song)) },
    { icon: "play", label: "Play next", run: () => player.playNext(song) },
    { icon: "queue", label: "Add to queue", run: () => player.enqueue(song) },
    isMusic && isOnline() && { icon: "plus", label: "Add to playlist", run: () => void openAddToPlaylist(song) },
    ...extra,
    saved
      ? { icon: "trash", label: "Remove from this device", danger: true, run: () => void removeOffline(song) }
      : { icon: "offline", label: "Save for offline", run: () => void saveOffline(song) },
    ...artistTargets(song.artist, song.artistId).filter(() => isMusic).map((artist, _, all) => ({ icon: "user" as const, label: all.length > 1 ? `Go to ${artist.name}` : "Go to artist", run: () => navigate(artist.to) })),
    Boolean(song.albumId) && { icon: "library", label: "Go to album", run: () => navigate(`/album/${song.albumId}`) },
    isMusic && isOnline() && isAdmin() && { icon: "pencil", label: "Edit details", run: () => navigate(`/song/${song.id}/edit`) },
    isMusic && isOnline() && isAdmin() && { icon: "trash", label: "Delete for everyone", danger: true, run: () => void deleteSongForEveryone(song) },
  ]);
}

/** A check when a song is on this device, or a ring while it is being saved. */
export function SavedStatus({ id }: { id: string }) {
  offline.useOfflineVersion();
  const saving = useSaving((s) => s.songs[id]);
  if (saving !== undefined) return <span className={ui.status}><Ring percent={saving} /></span>;
  if (offline.isSaved(id)) return <span className={ui.status} title="Saved on this device"><span className="inline-flex"><Icon name="offline" size={16} /></span></span>;
  return null;
}

interface SongRowProps {
  song: Song;
  list: Song[];
  index: number;
  numbered?: boolean;
  hideAlbum?: boolean;
  from?: LibraryEntry;
  rowMenu?: (song: Song, index: number) => SheetItem[];
}

/** A song in the library. Tapping it plays the whole list from here. */
export function SongRow({ song, list, index, numbered, hideAlbum, from, rowMenu }: SongRowProps) {
  const navigate = useNavigate();
  const { current, playing } = useIsCurrent(song.id);
  return (
    <li className={ui.row} data-current={current || undefined} data-playing={playing || undefined} data-id={song.id} onClick={() => player.play(list, index, from)}>
      {numbered ? <span className={ui.num}>{index + 1}</span> : <SongCover song={song} />}
      <div className={ui.text}><b>{song.title}</b><span>{song.artist}{!hideAlbum && song.album && <span className={ui.inLineAlbum}>{` · ${song.album}`}</span>}</span></div>
      {!hideAlbum && <span className={ui.colAlbum}>{song.album}</span>}
      <SavedStatus id={song.id} />
      <span className={ui.time}>{song.duration ? clock(song.duration) : ""}</span>
      <button className={ui.rowMore} aria-label="More" onClick={(e) => { e.stopPropagation(); songMenu(song, navigate, rowMenu?.(song, index)); }}><Icon name="more" size={20} /></button>
    </li>
  );
}

export function SongList({ songs, numbered, hideAlbum, from, rowMenu }: { songs: Song[]; numbered?: boolean; hideAlbum?: boolean; from?: LibraryEntry; rowMenu?: SongRowProps["rowMenu"] }) {
  const { visible, sentinel } = useIncremental(songs);
  return (
    <>
      <ul className={ui.rows}>
        {visible.map((song, i) => <SongRow key={`${song.id}-${i}`} song={song} list={songs} index={i} numbered={numbered} hideAlbum={hideAlbum} from={from} rowMenu={rowMenu} />)}
      </ul>
      {sentinel}
    </>
  );
}

function SongTile({ song, list, index }: { song: Song; list: Song[]; index: number }) {
  const navigate = useNavigate();
  const { current } = useIsCurrent(song.id);
  return (
    <Tile art={<SongCover song={song} size={300} className={cx(ui.coverBig, ui.cardCover)} />} title={song.title} subtitle={song.artist} current={current}
      onOpen={() => player.play(list, index)} onMenu={() => songMenu(song, navigate)} />
  );
}

/** Songs in a section of the library, as the person chose to see the library: cards or rows. */
export function LibrarySongs({ songs }: { songs: Song[] }) {
  const view = useSettings((s) => s.libraryView);
  const { visible, sentinel } = useIncremental(songs);
  if (view === "list") return <SongList songs={songs} />;
  return (
    <>
      <div className={ui.grid}>{visible.map((song, i) => <SongTile key={`${song.id}-${i}`} song={song} list={songs} index={i} />)}</div>
      {sentinel}
    </>
  );
}

/** Play and Shuffle for a list of songs, plus anything else that belongs next to them. */
export function PlayButtons({ songs, from, children }: { songs: Song[]; from?: LibraryEntry; children?: React.ReactNode }) {
  return (
    <div className={ui.actions}>
      <button className={ui.primary} onClick={() => player.play(songs, 0, from)}><Icon name="play" size={20} />Play</button>
      <button className={ui.pill} onClick={() => player.playShuffled(songs, from)}><Icon name="shuffle" size={16} />Shuffle</button>
      {children}
    </div>
  );
}

// ---- Songs you can download ----

const JOB_LABEL = { queued: "Queued", searching: "Finding…", tagging: "Finishing…" } as const;

async function startDownload(catalogId: string): Promise<void> {
  try { await requestSong(catalogId); } catch (e) { toast((e as Error).message); }
}

/** A catalogue result not in the library. Once downloaded it turns into a normal, playable row. */
export function ExternalRow({ ext }: { ext: ExternalSong }) {
  const job = liveJob(useJobs((s) => s.jobs[ext.id]));
  const ownedId = job?.state === "ready" ? job.library_id : undefined;
  const asSong = (id: string): Song => toSong({ id, title: ext.title, artist: ext.artist, album: ext.album, duration: ext.duration, cover: id });
  return (
    <li className={cx(ui.row, !ownedId && "[&>[data-art]]:opacity-[.92]")} onClick={ownedId ? () => player.play([asSong(ownedId)], 0) : undefined}>
      <Picture src={ext.cover_url} external />
      <div className={ui.text}><b>{ext.title}</b><span>{[ext.artist, ext.album].filter(Boolean).join(" · ")}</span></div>
      <span className={ui.download}>
        {!job && <button className={ui.get} aria-label={`Download ${ext.title}`} onClick={(e) => { e.stopPropagation(); void startDownload(ext.id); }}><Icon name="download" size={18} />Get</button>}
        {job?.state === "error" && <button className={ui.getRetry} title={job.error} onClick={(e) => { e.stopPropagation(); toast(job.error ?? "Download failed"); void startDownload(ext.id); }}>Retry</button>}
        {job?.state === "ready" && <span className={ui.done}><Icon name="check" size={18} /></span>}
        {job && job.state !== "error" && job.state !== "ready" && <JobProgress state={job.state} progress={job.progress} />}
      </span>
    </li>
  );
}

/** Spins until real progress arrives, then fills the ring. */
export function JobProgress({ state, progress }: { state: keyof typeof JOB_LABEL | "downloading"; progress: number }) {
  return (
    <>
      <Ring percent={state === "downloading" && progress > 0 ? progress : -1} />
      <span className={ui.downloadLabel}>{state === "downloading" ? `${Math.round(progress)}%` : JOB_LABEL[state]}</span>
    </>
  );
}

/** A "Get all" button for a list of external songs. */
export function GetAllButton({ externals }: { externals: ExternalSong[] }) {
  return (
    <button className={ui.pill} onClick={async (e) => {
      const { jobs } = useJobs.getState();
      const todo = externals.filter((ext) => !liveJob(jobs[ext.id]));
      if (!todo.length) { toast("Everything here is already on its way"); return; }
      e.currentTarget.disabled = true;
      toast(`Downloading ${todo.length} songs`);
      for (const ext of todo) {
        try { await requestSong(ext.id); } catch (err) { toast((err as Error).message); break; }
      }
    }}><Icon name="download" size={16} />{`Get all ${externals.length}`}</button>
  );
}
