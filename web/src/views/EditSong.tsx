// Changing what a song says about itself, for administrators: its title, who made it, its album. The server rewrites the
// tags of the file where it is, so the song keeps its favourites and playlists. A new album or album artist is another
// album for Navidrome, so the album's other songs can follow, or the album would come apart.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { editSongTags, getSongTags, type SongTags } from "../lib/api";
import { plural } from "../lib/format";
import { queryClient } from "../lib/query";
import { cx, ui } from "../lib/ui";
import { BackButton, Empty, Skeleton } from "../components/common";
import { ArtistsField, LABEL, NUMBER, PAGE } from "../components/fields";
import { Icon, Ring } from "../components/Icon";
import { SONG_LISTS } from "../stores/admin";
import { updateSong } from "../stores/player";
import { toast } from "../stores/ui";

export function EditSong() {
  const { id = "" } = useParams();
  const { data, error, isPending } = useQuery({ queryKey: ["song-tags", id], queryFn: () => getSongTags(id), staleTime: 0, gcTime: 0, retry: false });
  return (
    <>
      <BackButton />
      <header className={ui.heroCompact}><h1>Edit song</h1><p>{data ? data.tags.title : "What the song’s file says about it"}</p></header>
      {isPending && <div className={PAGE}><Skeleton rows={4} /></div>}
      {error && <Empty>{error.message}</Empty>}
      {data && <SongTagsForm id={id} tags={data.tags} others={data.album_songs} />}
    </>
  );
}

const joined = (names: string[]) => names.join("; ");

function SongTagsForm({ id, tags, others }: { id: string; tags: SongTags; others: number }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(tags.title);
  const [artists, setArtists] = useState(tags.artists);
  const [album, setAlbum] = useState(tags.album);
  const [albumArtists, setAlbumArtists] = useState(tags.album_artists);
  const [date, setDate] = useState(tags.date);
  const [track, setTrack] = useState(tags.track ? String(tags.track) : "");
  const [disc, setDisc] = useState(tags.disc ? String(tags.disc) : "");
  const [genre, setGenre] = useState(tags.genre);
  const [wholeAlbum, setWholeAlbum] = useState(true);
  const [busy, setBusy] = useState(false);

  const albumChanged = album.trim() !== tags.album || joined(albumArtists) !== joined(tags.album_artists) || date.trim() !== tags.date;
  const changed = albumChanged || title.trim() !== tags.title || joined(artists) !== joined(tags.artists) || (Number(track) || 0) !== tags.track
    || (Number(disc) || 0) !== tags.disc || genre.trim() !== tags.genre;
  const missing = !title.trim() ? "Give the song a title" : !artists.length ? "Add who made it" : !album.trim() ? "Give it an album" : "";

  async function save() {
    if (missing) { toast(missing); return; }
    setBusy(true);
    try {
      const result = await editSongTags(id, {
        title: title.trim(), artists, album: album.trim(), album_artists: albumArtists, date: date.trim(), track: Number(track) || 0,
        disc: Number(disc) || 0, genre: genre.trim(), whole_album: albumChanged && wholeAlbum && others > 0,
      });
      updateSong(id, { title: title.trim(), artist: artists.join(", "), album: album.trim(), albumId: result.album_id || undefined });
      for (const key of SONG_LISTS) void queryClient.invalidateQueries({ queryKey: [key] });
      if (result.failed.length) toast(`Saved, but ${plural(result.failed.length, "song")} of the album could not change: ${result.failed[0].error}`);
      else toast(result.changed ? "Saved" : "Nothing needed changing");
      if (result.album_id) navigate(`/album/${result.album_id}`, { replace: true }); else navigate(-1);
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }

  const sameAsSong = joined(albumArtists) === joined(artists);
  return (
    <form className={PAGE} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <fieldset className="grid gap-5 disabled:opacity-60" disabled={busy}>
        <label className={LABEL}><span>Title</span><input className={ui.input} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
        <ArtistsField label="Artists" value={artists} onChange={setArtists} placeholder={artists.length ? "Add another artist" : "Who made it"} />
        <label className={LABEL}><span>Album</span><input className={ui.input} value={album} maxLength={200} onChange={(e) => setAlbum(e.target.value)} /></label>
        <div className="grid gap-2">
          <ArtistsField label="Album artist" value={albumArtists} onChange={setAlbumArtists} placeholder={albumArtists.length ? "Add another" : "Who the album is by"} />
          {!sameAsSong && artists.length > 0 && (
            <button type="button" className={cx(ui.link, "justify-self-start px-1.5 text-[.88rem] font-semibold")} onClick={() => setAlbumArtists(artists)}>
              {`Use the song’s artists (${artists.join(", ")})`}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-4">
          <label className={LABEL}><span>Year or date</span><input className={cx(ui.input, "w-44")} placeholder="2021 or 2021-05-14" inputMode="numeric" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className={LABEL}><span>Track</span><input className={NUMBER} inputMode="numeric" placeholder="—" value={track} onChange={(e) => setTrack(e.target.value.replace(/\D/g, "").slice(0, 3))} /></label>
          <label className={LABEL}><span>Disc</span><input className={NUMBER} inputMode="numeric" placeholder="—" value={disc} onChange={(e) => setDisc(e.target.value.replace(/\D/g, "").slice(0, 2))} /></label>
        </div>
        <label className={LABEL}><span>Genre</span><input className={ui.input} value={genre} maxLength={200} placeholder="None" onChange={(e) => setGenre(e.target.value)} /></label>
        {albumChanged && others > 0 && (
          <button type="button" className="tap flex items-start gap-3 text-left px-1.5" role="checkbox" aria-checked={wholeAlbum} onClick={() => setWholeAlbum(!wholeAlbum)}>
            <span className={ui.tick} data-on={wholeAlbum || undefined}>{wholeAlbum && <Icon name="check" size={16} />}</span>
            <span className="grid gap-0.5">
              <b className="font-[650]">{`Change the album for its other ${plural(others, "song")} too`}</b>
              <span className="text-muted text-[.88rem]">Their album, album artist and date. Otherwise this song becomes an album of its own.</span>
            </span>
          </button>
        )}
      </fieldset>
      <p className="text-muted text-[.88rem] px-1.5">This changes the song for everyone. The file stays where it is, so favorites and playlists keep it, and a copy of the old file is kept in Eco’s backup folder.</p>
      <div className="flex flex-wrap items-center gap-2.5">
        <button className={ui.primary} type="submit" disabled={busy || !changed || missing !== ""}>{busy ? <Ring percent={-1} size={20} /> : <Icon name="check" size={20} />}{busy ? "Saving…" : "Save"}</button>
        {missing && <span className="text-muted text-[.88rem]">{missing}</span>}
      </div>
    </form>
  );
}
