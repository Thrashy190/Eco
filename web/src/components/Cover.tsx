import { useEffect, useState } from "react";
import { coverUrl, playlistCoverUrl, songCover } from "../lib/api";
import { hue, initials } from "../lib/format";
import type { Song } from "../lib/types";
import { FAVORITES_ID, useLibraryState } from "../stores/library";
import * as offline from "../stores/offline";
import { useOnline } from "../stores/settings";
import { Icon } from "./Icon";

interface PictureProps {
  src?: string | null;
  className?: string;
  /** Pictures from other sites should not learn where they were linked from. */
  external?: boolean;
}

/** A square image that falls back to a placeholder when there is no picture or it fails to load. */
export function Picture({ src, className = "cover", external }: PictureProps) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <div className={`${className} no-cover`}><Icon name="play" size={20} /></div>;
  return <img className={className} src={src} alt="" loading="lazy" draggable={false} referrerPolicy={external ? "no-referrer" : undefined} onError={() => setFailed(src)} />;
}

/** A song's cover. With no connection, saved songs use the picture stored with them. */
export function SongCover({ song, size = 96, className = "cover" }: { song: Song; size?: number; className?: string }) {
  const online = useOnline();
  const useSaved = !online && offline.isSaved(song.id);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!useSaved) return;
    let url: string | null = null;
    let cancelled = false;
    void offline.savedCoverUrl(song.id).then((found) => {
      if (cancelled) { if (found) URL.revokeObjectURL(found); return; }
      url = found;
      setSaved(found);
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [song.id, useSaved]);
  return <Picture src={useSaved ? saved : songCover(song, size)} className={className} />;
}

/** The picture of a playlist: the one the user chose, else Navidrome's (Favorites has its own heart). */
export function PlaylistArt({ id, cover, size = 300, className = "cover" }: { id: string; cover?: string; size?: number; className?: string }) {
  const { covers } = useLibraryState();
  const version = covers[id];
  if (version) return <Picture src={playlistCoverUrl(id, version)} className={className} />;
  if (id === FAVORITES_ID) return <div className={`${className} fav-cover`}><Icon name="heart-fill" size={className.includes("huge") ? 72 : className.includes("big") ? 48 : 22} /></div>;
  return <Picture src={coverUrl(cover, size)} className={className} />;
}

export function ArtistAvatar({ name, cover, size = 200, className = "avatar" }: { name: string; cover?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (cover && !failed) return <img className={className} src={coverUrl(cover, size)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
  return <div className={`${className} letters`} style={{ "--h": hue(name) } as React.CSSProperties}>{initials(name)}</div>;
}
