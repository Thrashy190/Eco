import { Link } from "react-router";
import { coverUrl, getAlbum } from "../lib/api";
import { plural } from "../lib/format";
import type { Album, Artist, ExternalAlbum, LibraryEntry, Song } from "../lib/types";
import { albumEntry, isPinned, togglePin, useLibraryState } from "../stores/library";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { useSaving, toggleCollection } from "../stores/saving";
import { toast } from "../stores/ui";
import { ArtistAvatar, Picture } from "./Cover";
import { Icon, Ring } from "./Icon";

export const AlbumCard = ({ album }: { album: Album }) => (
  <Link className="card" to={`/album/${album.id}`}>
    <span className="card-art">
      <Picture src={coverUrl(album.cover, 300)} className="cover big" />
      <button type="button" className="card-play" aria-label={`Play ${album.name}`} onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void getAlbum(album.id).then((whole) => player.play(whole.songs, 0, albumEntry(whole))).catch((err: Error) => toast(err.message));
      }}><Icon name="play" size={20} /></button>
    </span>
    <b>{album.name}</b><span>{album.artist}</span>
  </Link>
);

const ALBUM_TYPE: Record<string, string> = { album: "Album", single: "Single", compilation: "Compilation" };

/** An album in the catalogue: it opens its full track list, showing which songs are downloaded. */
export const ExternalAlbumCard = ({ album }: { album: ExternalAlbum }) => (
  <Link className="card" to={`/catalog-album/${album.id}`}>
    <Picture src={album.cover_url} className="cover big" external />
    <b>{album.name}</b>
    <span>{[ALBUM_TYPE[album.album_type ?? ""] ?? "Album", album.year, album.artist].filter(Boolean).join(" · ")}</span>
  </Link>
);

export const ArtistCard = ({ artist }: { artist: Artist }) => (
  <Link className="card artist" to={`/artist/${artist.id}`}>
    <ArtistAvatar name={artist.name} cover={artist.cover} />
    <b>{artist.name}</b>
    <span>{artist.albumCount !== undefined ? plural(artist.albumCount, "album") : "Artist"}</span>
  </Link>
);

/** Pin or unpin what this page shows. */
export function PinButton({ entry }: { entry: LibraryEntry }) {
  const { pins } = useLibraryState();
  const pinned = isPinned(pins, entry);
  return (
    <button type="button" className={`pill pin-toggle${pinned ? " on" : ""}`} aria-pressed={pinned} onClick={() => void togglePin(entry)}>
      <Icon name={pinned ? "pin-fill" : "pin"} size={16} />{pinned ? "Pinned" : "Pin"}
    </button>
  );
}

/** A "Download" button for keeping a collection on this device. */
export function DownloadToggle({ spec, songs }: { spec: Parameters<typeof toggleCollection>[0]; songs: Song[] }) {
  offline.useOfflineVersion();
  const progress = useSaving((s) => s.collections[spec.id]);
  const saved = offline.isCollectionSaved(spec.id);
  let content;
  if (progress) {
    const percent = progress.total ? ((progress.done + Math.max(progress.percent, 0) / 100) / progress.total) * 100 : 0;
    content = <><Ring percent={percent} size={18} />{`${Math.min(progress.done + 1, progress.total)}/${progress.total}`}</>;
  } else if (saved) {
    content = <><Icon name="check" size={16} />Downloaded</>;
  } else {
    content = <><Icon name="offline" size={16} />Download</>;
  }
  return <button type="button" className={`pill download-toggle${saved ? " on" : ""}`} onClick={() => void toggleCollection(spec, songs)}>{content}</button>;
}
