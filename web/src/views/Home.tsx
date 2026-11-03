import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { getHome, toAlbum, toSong, username } from "../lib/api";
import { greeting } from "../lib/format";
import { homeOrder } from "../lib/nav";
import type { RawAlbum } from "../lib/types";
import { AlbumCard } from "../components/cards";
import { Empty, OfflineBanner, Pill, Section, Shelf, Skeleton, Welcome } from "../components/common";
import { Icon } from "../components/Icon";
import { PlaylistArt, SongCover } from "../components/Cover";
import { SongList } from "../components/songs";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { useOnline, useSettings } from "../stores/settings";

const Albums = ({ list }: { list: RawAlbum[] }) => <Shelf>{list.map((a) => <AlbumCard key={a.id} album={toAlbum(a)} />)}</Shelf>;

function HomeOnline() {
  const navigate = useNavigate();
  const order = useSettings((s) => s.homeOrder);
  const hidden = useSettings((s) => s.homeHidden);
  const { data, error, isPending } = useQuery({ queryKey: ["home"], queryFn: getHome });
  if (isPending) return <Skeleton />;
  if (error) return <Empty>{error.message}</Empty>;
  const downloaded = data.downloads.filter((j) => j.library_id).map((j) => toSong({ id: j.library_id!, title: j.title, artist: j.artist, album: j.album, cover: j.library_id }));
  const random = data.random_songs.map(toSong);
  const isEmpty = !data.recent.length && !downloaded.length && !data.newest.length && !data.frequent.length && !random.length;
  if (isEmpty) {
    return (
      <Welcome title="Your library is empty">
        <p>Search for a song or an artist and tap Get to download it.</p>
        <button className="primary" onClick={() => navigate("/search")}><Icon name="search" size={20} />Search</button>
      </Welcome>
    );
  }
  const sections: Record<string, ReactNode> = {
    recent: data.recent.length > 0 && <Section key="recent" title="Jump back in"><Albums list={data.recent} /></Section>,
    downloaded: downloaded.length > 0 && <Section key="downloaded" title="Just downloaded"><SongList songs={downloaded} hideAlbum /></Section>,
    newest: data.newest.length > 0 && <Section key="newest" title="Recently added"><Albums list={data.newest} /></Section>,
    frequent: data.frequent.length > 0 && <Section key="frequent" title="Most played"><Albums list={data.frequent} /></Section>,
    mix: random.length > 0 && <Section key="mix" title="Mix for you" action={<Pill icon="shuffle" onClick={() => player.playShuffled(random)}>Shuffle</Pill>}><SongList songs={random} /></Section>,
  };
  const visible = homeOrder(order).filter((id) => !hidden.includes(id));
  if (!visible.some((id) => sections[id])) {
    return <Welcome title="Nothing to show here"><p>Every section with something in it is hidden.</p><Link className="primary" to="/settings"><Icon name="sliders" size={20} />Choose in Settings</Link></Welcome>;
  }
  return <>{visible.map((id) => sections[id])}</>;
}

/** A saved collection as a card. Favorites shows its heart; the others, their first song's picture. */
export function CollectionCover({ id, className = "cover big" }: { id: string; className?: string }) {
  if (id === "favorites") return <PlaylistArt id={id} className={className} />;
  const first = offline.collectionSongs(id)[0];
  if (first) return <SongCover song={first} size={300} className={className} />;
  return <div className={`${className} no-cover`}><Icon name="play" size={24} /></div>;
}

function HomeOffline() {
  offline.useOfflineVersion();
  const collections = offline.collectionList().filter((c) => c.complete);
  const saved = offline.list().filter((s) => !s.kind);
  const spoken = offline.list().filter((s) => s.kind);
  return (
    <>
      <OfflineBanner />
      {!collections.length && !saved.length && !spoken.length && (
        <Welcome title="Nothing saved yet">
          <p>When you are online, tap Download on your favorites, a playlist or an album, or use the ⋯ menu on a song. It will be here without a connection.</p>
        </Welcome>
      )}
      {collections.length > 0 && (
        <Section title="Downloaded">
          <Shelf>{collections.map((c) => (
            <Link className="card" key={c.id} to={offline.collectionRoute(c.id)}><CollectionCover id={c.id} /><b>{c.title}</b><span>{c.subtitle}</span></Link>
          ))}</Shelf>
        </Section>
      )}
      {saved.length > 0 && <Section title="Saved songs" action={<Pill icon="play" onClick={() => player.play(saved, 0)}>Play</Pill>}><SongList songs={saved} /></Section>}
      {spoken.length > 0 && <Section title="Podcasts & more"><SongList songs={spoken} /></Section>}
    </>
  );
}

export function Home() {
  const online = useOnline();
  const user = username();
  return (
    <>
      <header className="hero">
        <h1>{greeting()}</h1>
        <p>{user && `Signed in as ${user}`}</p>
      </header>
      {online ? <HomeOnline /> : <HomeOffline />}
    </>
  );
}
