import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { coverUrl, getAlbum, getHome, toAlbum, toSong, username } from "../lib/api";
import { greeting } from "../lib/format";
import { useWide } from "../lib/media";
import { homeOrder } from "../lib/nav";
import type { Album, RawAlbum } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { AlbumCard, SavedCard } from "../components/cards";
import { Empty, OfflineBanner, Pill, Section, Shelf, Skeleton, Welcome } from "../components/common";
import { Icon } from "../components/Icon";
import { Picture, PlaylistArt, SongCover, UserAvatar } from "../components/Cover";
import { Logo } from "../components/Logo";
import { SongList } from "../components/songs";
import { albumEntry } from "../stores/library";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { useOnline, useSettings } from "../stores/settings";
import { toast } from "../stores/ui";

const Albums = ({ list }: { list: RawAlbum[] }) => <Shelf>{list.map((a) => <AlbumCard key={a.id} album={toAlbum(a)} />)}</Shelf>;

/**
 * What you were listening to is not one more row: the last album gets the stage, one tap from playing, with the next few
 * beside it or under it.
 */
function Spotlight({ list }: { list: RawAlbum[] }) {
  const wide = useWide();
  const [first, ...rest]: Album[] = list.map(toAlbum);
  const start = () => void getAlbum(first.id).then((whole) => player.play(whole.songs, 0, albumEntry(whole))).catch((e: Error) => toast(e.message));
  return (
    <section className={cx(ui.block, "mt-2! mt-0! px-4 grid gap-3.5 wide:px-8 wide:gap-5 @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}>
      <div className="relative isolate overflow-hidden flex items-end gap-4 min-h-52 p-4 rounded-[28px] wide:gap-5 wide:min-h-64 wide:p-5 bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
        <Picture src={coverUrl(first.cover, 96)} className="absolute inset-0 -z-10 size-full object-cover scale-125 blur-2xl saturate-150 opacity-60" />
        <Link to={`/album/${first.id}`} className="flex-none w-[clamp(112px,36%,200px)]" aria-label={first.name}>
          <Picture src={coverUrl(first.cover, 400)} className="w-full h-auto aspect-square rounded-big object-cover bg-surface-3 shadow-[0_18px_40px_rgb(0_0_0/.45)]" />
        </Link>
        <div className="flex-1 min-w-0 grid gap-1 justify-items-start pb-1">
          <span className="text-[.8rem] font-semibold">Jump back in</span>
          <Link to={`/album/${first.id}`} className="w-full font-title text-[clamp(1.5rem,3.2cqi,2.5rem)] font-bold leading-[1.05] tracking-[-.03em] line-clamp-2 hover:underline">{first.name}</Link>
          <span className="w-full truncate font-medium">{first.artist}</span>
          <button type="button" className={cx(ui.primary, "mt-2.5")} onClick={start}><Icon name="play" size={20} />Play</button>
        </div>
      </div>
      {rest.length > 0 && (
        <ul className="stagger grid grid-cols-2 wide:grid-cols-3 @4xl:grid-cols-2 gap-2.5 content-start">
          {rest.slice(0, wide ? 6 : 4).map((album) => (
            <li key={album.id}>
              <Link to={`/album/${album.id}`} className="tap flex items-center gap-3 h-full p-2 rounded-[18px] bg-ghost hover:brightness-125 active:scale-[.98]">
                <Picture src={coverUrl(album.cover, 96)} className="size-12 flex-none rounded-xl object-cover bg-surface-2 wide:size-14" />
                <span className="min-w-0 grid [&>*]:truncate"><b className="font-semibold text-[.92rem]">{album.name}</b><span className="text-muted text-[.8rem]">{album.artist}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

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
        <button className={ui.primary} onClick={() => navigate("/search")}><Icon name="search" size={20} />Search</button>
      </Welcome>
    );
  }
  const sections: Record<string, ReactNode> = {
    recent: data.recent.length > 0 && <Spotlight key="recent" list={data.recent} />,
    downloaded: downloaded.length > 0 && <Section key="downloaded" title="Just downloaded"><SongList songs={downloaded} hideAlbum /></Section>,
    newest: data.newest.length > 0 && <Section key="newest" title="Recently added"><Albums list={data.newest} /></Section>,
    frequent: data.frequent.length > 0 && <Section key="frequent" title="Most played"><Albums list={data.frequent} /></Section>,
    mix: random.length > 0 && <Section key="mix" title="Mix for you" action={<Pill icon="shuffle" onClick={() => player.playShuffled(random)}>Shuffle</Pill>}><SongList songs={random} /></Section>,
  };
  const visible = homeOrder(order).filter((id) => !hidden.includes(id));
  if (!visible.some((id) => sections[id])) {
    return <Welcome title="Nothing to show here"><p>Every section with something in it is hidden.</p><Link className={ui.primary} to="/settings"><Icon name="sliders" size={20} />Choose in Settings</Link></Welcome>;
  }
  return <>{visible.map((id) => sections[id])}</>;
}

/** A saved collection as a card. Favorites shows its heart; the others, their first song's picture. */
export function CollectionCover({ id, className = ui.coverBig }: { id: string; className?: string }) {
  if (id === "favorites") return <PlaylistArt id={id} className={className} />;
  const first = offline.collectionSongs(id)[0];
  if (first) return <SongCover song={first} size={300} className={className} />;
  return <div data-art="" className={cx(className, ui.noCover)}><Icon name="play" size={24} /></div>;
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
          <Shelf>{collections.map((c) => <SavedCard key={c.id} to={offline.collectionRoute(c.id)} art={<CollectionCover id={c.id} className={cx(ui.coverBig, ui.cardCover)} />} title={c.title} subtitle={c.subtitle} />)}</Shelf>
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
      {/* A phone has no top bar: the logo and your account start the page */}
      <div className="flex items-center justify-between px-5 pt-2 wide:hidden">
        <span className="flex items-center gap-2 font-title font-bold text-[1.2rem] tracking-[-.03em]"><Logo size={30} />Eco</span>
        <Link to="/settings" aria-label="Settings" className="size-9 grid place-items-center rounded-full overflow-hidden bg-ghost font-extrabold text-[.72rem]"><UserAvatar /></Link>
      </div>
      <header className={ui.hero}>
        <h1>{greeting()}</h1>
        <p>{user && `Signed in as ${user}`}</p>
      </header>
      {online ? <HomeOnline /> : <HomeOffline />}
    </>
  );
}
