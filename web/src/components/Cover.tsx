import { useEffect, useState } from "react";
import { avatarUrl, coverUrl, playlistCoverUrl, songCover, username } from "../lib/api";
import { hue, initials } from "../lib/format";
import type { Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
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

/** A square image that falls back to a placeholder when there is no picture or it fails to load. data-art lets a row size it. */
export function Picture({ src, className = ui.cover, external }: PictureProps) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <div data-art="" className={cx(className, ui.noCover)}><Icon name="play" size={20} /></div>;
  return <img data-art="" className={className} src={src} alt="" loading="lazy" draggable={false} referrerPolicy={external ? "no-referrer" : undefined} onError={() => setFailed(src)} />;
}

/** A song's cover. With no connection, saved songs use the picture stored with them. */
export function SongCover({ song, size = 96, className = ui.cover }: { song: Song; size?: number; className?: string }) {
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
export function PlaylistArt({ id, cover, size = 300, className = ui.cover }: { id: string; cover?: string; size?: number; className?: string }) {
  const { covers } = useLibraryState();
  const version = covers[id];
  if (version) return <Picture src={playlistCoverUrl(id, version)} className={className} />;
  if (id === FAVORITES_ID) return <div data-art="" className={cx(className, ui.favCover)}><Icon name="heart-fill" size={className === ui.coverHuge ? 72 : className.startsWith(ui.coverBig) ? 48 : 22} /></div>;
  return <Picture src={coverUrl(cover, size)} className={className} />;
}

/** Who is signed in: the picture they chose, or their initials. */
export function UserAvatar({ className }: { className?: string }) {
  const { avatar } = useLibraryState();
  if (avatar) return <img className={cx("size-full object-cover", className)} src={avatarUrl(avatar)} alt="" draggable={false} />;
  return <span className={className}>{initials(username())}</span>;
}

export function ArtistAvatar({ name, cover, size = 200, className = ui.avatar }: { name: string; cover?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (cover && !failed) return <img data-art="" className={className} src={coverUrl(cover, size)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
  return <div data-art="" className={cx(className, ui.letters)} style={{ "--h": hue(name) } as React.CSSProperties}>{initials(name)}</div>;
}
