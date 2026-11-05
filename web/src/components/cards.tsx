import { Link } from "react-router";
import { coverUrl, getAlbum } from "../lib/api";
import { plural } from "../lib/format";
import type { Album, Artist, ExternalAlbum, LibraryEntry, Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { albumEntry, isPinned, togglePin, useLibraryState } from "../stores/library";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { useSaving, toggleCollection } from "../stores/saving";
import { toast } from "../stores/ui";
import { ArtistAvatar, Picture } from "./Cover";
import { Icon, Ring } from "./Icon";

const playAlbum = (id: string) => getAlbum(id).then((whole) => player.play(whole.songs, 0, albumEntry(whole))).catch((err: Error) => toast(err.message));

export const AlbumCard = ({ album }: { album: Album }) => (
  <Link className={ui.card} to={`/album/${album.id}`}>
    <span className={ui.cardArt}>
      <Picture src={coverUrl(album.cover, 300)} className={cx(ui.coverBig, ui.cardCover)} />
      {/* Only where a mouse can reveal it: on a touch screen an invisible button would catch taps meant for the album */}
      <button type="button" className="tap absolute inset-0 m-auto hidden size-14 place-items-center rounded-full bg-glass-strong text-text backdrop-blur-xl shadow-[0_12px_30px_rgb(0_0_0/.4),inset_0_0_0_1px_var(--line)] opacity-0 scale-90 can-hover:wide:grid group-hover/card:opacity-100 group-hover/card:scale-100 focus-visible:opacity-100 focus-visible:scale-100 hover:bg-accent hover:text-accent-ink"
        aria-label={`Play ${album.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void playAlbum(album.id); }}>
        <Icon name="play" size={22} />
      </button>
    </span>
    <b>{album.name}</b><span>{album.artist}</span>
  </Link>
);

const ALBUM_TYPE: Record<string, string> = { album: "Album", single: "Single", compilation: "Compilation" };

/** An album in the catalogue: it opens its full track list, showing which songs are downloaded. */
export const ExternalAlbumCard = ({ album }: { album: ExternalAlbum }) => (
  <Link className={ui.card} to={`/catalog-album/${album.id}`}>
    <Picture src={album.cover_url} className={cx(ui.coverBig, ui.cardCover)} external />
    <b>{album.name}</b>
    <span>{[ALBUM_TYPE[album.album_type ?? ""] ?? "Album", album.year, album.artist].filter(Boolean).join(" · ")}</span>
  </Link>
);

export const ArtistCard = ({ artist }: { artist: Artist }) => (
  <Link className={ui.cardArtist} to={`/artist/${artist.id}`}>
    <ArtistAvatar name={artist.name} cover={artist.cover} />
    <b>{artist.name}</b>
    <span>{artist.albumCount !== undefined ? plural(artist.albumCount, "album") : "Artist"}</span>
  </Link>
);

/** A collection saved on this device, as a card. */
export const SavedCard = ({ to, art, title, subtitle }: { to: string; art: React.ReactNode; title: string; subtitle: string }) => (
  <Link className={ui.card} to={to}>{art}<b>{title}</b><span>{subtitle}</span></Link>
);

/** Pin or unpin what this page shows. */
export function PinButton({ entry }: { entry: LibraryEntry }) {
  const { pins } = useLibraryState();
  const pinned = isPinned(pins, entry);
  return (
    <button type="button" className={ui.pill} data-on={pinned || undefined} aria-pressed={pinned} onClick={() => void togglePin(entry)}>
      <Icon name={pinned ? "pin-fill" : "pin"} size={16} />{pinned ? "Pinned" : "Pin"}
    </button>
  );
}

/** A "Download" button for keeping a collection on this device. */
export function DownloadToggle({ spec, songs }: { spec: Parameters<typeof toggleCollection>[0]; songs: Song[] }) {
  offline.useOfflineVersion();
  const progress = useSaving((s) => s.collections[spec.id]);
  const saved = offline.isCollectionSaved(spec.id);
  const unfinished = !saved && Boolean(offline.collection(spec.id)?.songs);
  let content;
  if (progress) {
    const percent = progress.total ? ((progress.done + Math.max(progress.percent, 0) / 100) / progress.total) * 100 : 0;
    const count = `${Math.min(progress.done + 1, progress.total)}/${progress.total}`;
    content = <><Ring percent={percent} size={18} />{progress.waiting ? `Waiting · ${count}` : count}</>;
  } else if (saved) {
    content = <><Icon name="check" size={16} />Downloaded</>;
  } else if (unfinished) {
    content = <><Icon name="offline" size={16} />Resume</>;
  } else {
    content = <><Icon name="offline" size={16} />Download</>;
  }
  return <button type="button" className={cx(ui.pill, "gap-2")} data-on={saved || undefined} onClick={() => void toggleCollection(spec, songs)}>{content}</button>;
}
