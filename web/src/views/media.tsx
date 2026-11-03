// Imported audio: podcasts, audiobooks and anything else pasted from a YouTube link. Only the sound is kept.
// The import card (shown in Search when you paste a link) and the Library sections for each category.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import * as api from "../lib/api";
import { clock } from "../lib/format";
import { queryClient } from "../lib/query";
import type { MediaItem, MediaKind, MediaPreview, Song } from "../lib/types";
import { Empty, Skeleton, Welcome } from "../components/common";
import { SongCover } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { isAdmin } from "../stores/admin";
import { isActive, requestMedia, useJobs } from "../stores/downloads";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { saveOffline } from "../stores/saving";
import { useOnline } from "../stores/settings";
import { openSheet, toast } from "../stores/ui";

const CATEGORY_HINT: Record<MediaKind, string> = {
  podcast: "Remembers where you stopped and can play faster",
  audiobook: "Remembers your place and plays at your speed",
  other: "Anything else: lectures, talks, sounds",
};

// ---------------- Import card (Search) ----------------

export function ImportPanel({ link }: { link: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ["media-preview", link], queryFn: () => api.mediaPreview(link), retry: false, staleTime: 60_000 });
  if (isPending) return <div className="import"><Skeleton rows={2} /></div>;
  if (error) return <div className="import"><Welcome title="Could not read that link"><p>{error.message}</p></Welcome></div>;
  return <div className="import"><PreviewCard link={link} preview={data} /></div>;
}

function PreviewCard({ link, preview }: { link: string; preview: MediaPreview }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<MediaKind>("podcast");
  const job = useJobs((s) => s.jobs[`media:${preview.id}`]);
  // A running job (started earlier or from another device) is picked up again. A finished one is history unless
  // this card started it: the item may have been deleted since.
  const [startedHere, setStartedHere] = useState(false);
  const current = job && (isActive(job) || startedHere) ? job : undefined;
  const start = useMutation({
    mutationFn: () => requestMedia(link, kind),
    onSuccess: (result) => {
      if (result.existing) { toast("Already in your library"); navigate(`/library/${result.existing.kind}`); return; }
      setStartedHere(true);
    },
    onError: (e) => toast(e.message),
  });

  const head = (
    <div className="import-head">
      <div className="import-thumb">
        {preview.thumbnail ? <img src={preview.thumbnail} alt="" referrerPolicy="no-referrer" /> : <Icon name="play" size={28} />}
        {preview.duration > 0 && <span className="badge">{clock(preview.duration)}</span>}
      </div>
      <div className="import-info"><b>{preview.title}</b><span>{preview.channel}</span></div>
    </div>
  );

  if (preview.existing) {
    const where = api.kindLabel(preview.existing.kind);
    return (
      <>
        {head}
        <p className="note">{`Already in your library as ${where}.`}</p>
        <button className="primary" onClick={() => navigate(`/library/${preview.existing!.kind}`)}>{`Open ${where}`}</button>
      </>
    );
  }
  if (preview.live) return <>{head}<p className="note">This is a live stream, which cannot be imported.</p></>;

  let action;
  if (current?.state === "error") {
    action = <><p className="note error-note">{current.error}</p><button className="pill" onClick={() => start.mutate()}>Try again</button></>;
  } else if (current?.state === "ready") {
    const label = api.kindLabel(current.kind ?? kind);
    action = (
      <>
        <div className="done-row"><Icon name="check" />{`Added to ${label}`}</div>
        <button className="primary" onClick={() => navigate(`/library/${current.kind ?? kind}`)}>{`Open ${label}`}</button>
      </>
    );
  } else if (current) {
    const downloading = current.state === "downloading";
    action = <div className="done-row"><Ring percent={downloading && current.progress > 0 ? current.progress : -1} size={26} />{downloading ? `Downloading ${Math.round(current.progress)}%` : "Getting ready…"}</div>;
  } else {
    action = <button className="primary" type="button" disabled={start.isPending} onClick={() => start.mutate()}><Icon name="download" size={20} />Add audio to library</button>;
  }

  return (
    <>
      {head}
      <div className="group-title">What is it?</div>
      <div className="chips" role="group" aria-label="What is it?">
        {api.KINDS.map(([value, label]) => <button key={value} type="button" className="chip" aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}
      </div>
      <p className="note">{`${CATEGORY_HINT[kind]}. Only the audio is downloaded, and it stays apart from your music.`}</p>
      <div className="import-action">{action}</div>
    </>
  );
}

// ---------------- Library sections ----------------

const savedPercent = (item: MediaItem) => {
  const at = player.savedPosition(`m-${item.id}`);
  return item.duration && at ? Math.min(99, Math.round((at / item.duration) * 100)) : 0;
};

function itemMenu(item: MediaItem, song: Song): void {
  openSheet(item.title, item.channel, [
    offline.isSaved(song.id)
      ? { icon: "trash", label: "Remove from this device", danger: true, run: () => void offline.remove(song.id).then(() => toast("Removed from this device")) }
      : { icon: "offline", label: "Save for offline", run: () => void saveOffline(song) },
    isAdmin() && { icon: "trash", label: "Delete for everyone", danger: true, run: async () => {
      if (!confirm(`Delete “${item.title}” for everyone?\n\nThe file is erased from the server. This cannot be undone.`)) return;
      try {
        await api.deleteMedia(item.id);
        await offline.remove(song.id);
        player.forgetSong(song.id);
        player.clearPosition(song.id);
        toast("Deleted");
        void queryClient.invalidateQueries({ queryKey: ["media"] });
      } catch (e) { toast((e as Error).message); }
    } },
  ]);
}

export function MediaLibrary({ kind }: { kind: MediaKind }) {
  const online = useOnline();
  offline.useOfflineVersion();
  const navigate = useNavigate();
  const { data, error, isPending } = useQuery({ queryKey: ["media", kind], queryFn: () => api.listMedia(kind), enabled: online });
  const items: MediaItem[] | undefined = online ? data
    : offline.list().filter((s) => s.kind === kind && s.mediaId).map((s) => ({ id: s.mediaId!, kind, title: s.title, channel: s.artist, duration: s.duration ?? 0, size: s.size }));
  const label = api.kindLabel(kind);

  let body;
  if (online && isPending) body = <Skeleton rows={2} />;
  else if (online && error) body = <Empty>{error.message}</Empty>;
  else if (!items?.length) {
    body = (
      <Welcome title={`No ${label.toLowerCase()}s yet`}>
        <p>Paste a YouTube link in Search, choose what it is, and its audio shows up here.</p>
      </Welcome>
    );
  } else {
    const songs = items.map(api.mediaSong);
    body = (
      <ul className="rows">
        {items.map((item, i) => {
          const percent = savedPercent(item);
          return (
            <li className="row" key={item.id} data-id={songs[i].id} onClick={() => player.play(songs, i)}>
              <SongCover song={songs[i]} />
              <div className="text">
                <b>{item.title}</b>
                <span>{[item.channel, item.duration ? clock(item.duration) : "", percent ? `${percent}% played` : ""].filter(Boolean).join(" · ")}</span>
              </div>
              <button className="icon-button" aria-label="More" onClick={(e) => { e.stopPropagation(); itemMenu(item, songs[i]); }}><Icon name="more" size={20} /></button>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <>
      <div className="media-head"><button className="pill" onClick={() => navigate("/search")}><Icon name="plus" size={16} />Add from YouTube link</button></div>
      {body}
    </>
  );
}
