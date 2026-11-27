// The people on this server and their profiles, read like an artist's page: what they play most this month (the order,
// never how often), their public playlists and their favorites. Each part shows unless its owner hid it, which the server
// decides; a profile needs a connection.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router";
import { coverUrl, getPeople, getPerson, getPersonFavorites, personAvatarUrl, personBannerUrl } from "../lib/api";
import { clock, hue, initials, plural } from "../lib/format";
import { positionAt, stillPlaying, type NowPlaying } from "../lib/listening";
import type { Person, Profile } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { BackButton, DetailPage, Empty, Section, Shelf, Skeleton, Welcome } from "../components/common";
import { Picture, SongCover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { PlayButtons, SongList } from "../components/songs";
import { useLiveListening, useNowPlaying } from "../stores/people";
import * as player from "../stores/player";
import { useOnline } from "../stores/settings";

const PREVIEW = 10;
const HUE_FILL = "bg-[linear-gradient(135deg,hsl(var(--h)_55%_42%),hsl(calc(var(--h)+40)_60%_28%))]";

/** Someone's picture, or their initials on their own colour. */
export function PersonAvatar({ person, className = ui.avatar }: { person: Person; className?: string }) {
  if (person.avatar) return <img data-art="" className={cx(className, "object-cover")} src={personAvatarUrl(person.user, person.avatar)} alt="" loading="lazy" draggable={false} />;
  return <div data-art="" className={cx(className, ui.letters)} style={{ "--h": hue(person.user) } as CSSProperties}>{initials(person.name)}</div>;
}

/** The time now, again every so often, for what moves with the clock. */
function useClock(every: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/** What someone plays now, or null once their device has gone quiet. */
function useLive(user: string, every: number): { now: NowPlaying | null; at: number } {
  const now = useNowPlaying(user);
  const at = useClock(every);
  return { now: now && stillPlaying(now, at) ? now : null, at };
}

/** Three bars dancing: music is playing. */
const Bars = () => (
  <span className="inline-flex items-end gap-0.5 h-3" aria-hidden>
    {[0, 0.25, 0.5].map((delay) => <span key={delay} className="w-0.75 h-full rounded-full bg-current origin-bottom animate-bars" style={{ animationDelay: `${delay}s` }} />)}
  </span>
);

function PersonCard({ person }: { person: Person }) {
  const { now } = useLive(person.user, 15_000);
  return (
    <Link className={ui.cardArtist} to={`/people/${encodeURIComponent(person.user)}`}>
      <span className="relative block">
        <PersonAvatar person={person} className={cx(ui.avatar, now && "shadow-[0_0_0_3px_var(--accent),0_0_24px_rgb(var(--glow)/.5)]")} />
        {now && <span className="absolute right-[4%] bottom-[4%] grid place-items-center size-8 rounded-full bg-accent text-accent-ink shadow-[0_0_0_3px_var(--bg)]"><Bars /></span>}
      </span>
      <b>{person.name}</b>
      <span className={now ? "text-accent!" : undefined}>{now ? now.song.title : person.me ? "You" : `@${person.user}`}</span>
    </Link>
  );
}

/** The song someone plays right now, moving along, and a button to play it here too. */
function ListeningNow({ now, at }: { now: NowPlaying; at: number }) {
  const { song } = now;
  const position = positionAt(now, at);
  const percent = song.duration ? Math.min(100, (position / song.duration) * 100) : 0;
  const title = song.albumId ? <Link className="hover:underline" to={`/album/${song.albumId}`}>{song.title}</Link> : song.title;
  return (
    <section className="rise flex items-center gap-3.5 mx-4 mt-4 p-3 pr-4 rounded-card bg-glass-strong shadow-[inset_0_0_0_1px_var(--line)] wide:mx-8 wide:max-w-xl">
      <SongCover song={song} size={120} className="size-16 rounded-xl object-cover bg-surface-2 flex-none" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-accent text-[.72rem] font-extrabold uppercase tracking-[.08em]"><Bars />Listening now</div>
        <b className="block truncate mt-0.5">{title}</b>
        <span className="block truncate text-muted text-[.86rem]">{[song.artist, song.album].filter(Boolean).join(" · ")}</span>
        {song.duration ? (
          <div className="flex items-center gap-2 mt-1.5 text-muted text-[.72rem] tabular-nums">
            <span>{clock(position)}</span>
            <span className="relative flex-1 h-1 rounded-full bg-ghost overflow-hidden"><span className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${percent}%` }} /></span>
            <span>{clock(song.duration)}</span>
          </div>
        ) : null}
      </div>
      <button type="button" className="tap flex-none size-11 grid place-items-center rounded-full bg-accent text-accent-ink active:scale-[.94]" aria-label={`Play ${song.title} here`} onClick={() => player.play([song], 0)}>
        <Icon name="play" size={20} />
      </button>
    </section>
  );
}

export function PeopleView() {
  const online = useOnline();
  useLiveListening();
  const { data: people, error, isPending } = useQuery({ queryKey: ["people"], queryFn: getPeople, enabled: online });
  let body;
  if (!online) body = <Empty>People need a connection.</Empty>;
  else if (isPending) body = <Skeleton rows={4} />;
  else if (error) body = <Empty>{error.message}</Empty>;
  else {
    const sorted = [...people.filter((p) => p.me), ...people.filter((p) => !p.me)];
    body = sorted.length > 1
      ? <div className={ui.grid}>{sorted.map((p) => <PersonCard key={p.user} person={p} />)}</div>
      : <><div className={ui.grid}>{sorted.map((p) => <PersonCard key={p.user} person={p} />)}</div><Welcome title="Nobody else yet"><p>People appear here once they sign in to Eco on this server.</p></Welcome></>;
  }
  return (
    <>
      <header className={ui.hero}><h1>People</h1><p>Everyone who listens on this server</p></header>
      {body}
    </>
  );
}

/** The cover across the top of a profile, with the person's picture over its edge. The name sits below, never on the picture. */
function ProfileHeader({ person }: { person: Person }) {
  const { now, at } = useLive(person.user, 1000);
  return (
    <>
      <header className="rise px-4 pt-1 wide:px-8">
        <div className={cx("w-full aspect-[5/2] wide:aspect-[9/2] max-h-72 overflow-hidden rounded-big", !person.banner && HUE_FILL)} style={{ "--h": hue(person.user) } as CSSProperties}>
          {person.banner ? <img className="size-full object-cover" src={personBannerUrl(person.user, person.banner)} alt="" draggable={false} /> : null}
        </div>
        {/* Only the picture rises over the cover's edge; the name starts below it */}
        <div className="flex items-start gap-4 px-3 wide:gap-5 wide:px-6">
          <PersonAvatar person={person} className="relative flex-none size-28 -mt-12 rounded-full bg-surface-2 shadow-[0_0_0_4px_var(--bg),0_18px_40px_rgb(0_0_0/.35)] wide:size-36 wide:-mt-16" />
          <div className="min-w-0 pt-3 wide:pt-4 [&_h1]:font-title [&_h1]:font-bold [&_h1]:leading-[1.03] [&_h1]:tracking-[-.04em] [&_h1]:text-[clamp(1.9rem,8cqi,2.6rem)] [&_h1]:wrap-anywhere wide:[&_h1]:text-[clamp(2.2rem,4.5cqi,3.6rem)] [&_p]:mt-1 [&_p]:text-muted">
            <h1>{person.name}</h1>
            <p>{`@${person.user}`}{person.me ? " · you" : ""}{now ? "" : " · Not listening right now"}</p>
          </div>
        </div>
      </header>
      {now && <ListeningNow now={now} at={at} />}
    </>
  );
}

/** A part only its owner sees, because they hid it from everyone else. */
const OnlyYou = () => <span className="inline-flex items-center gap-1.5 text-muted text-[.82rem] font-semibold"><Icon name="eye" size={15} />Only you see this</span>;

function ProfileBody({ profile }: { profile: Profile }) {
  const base = `/people/${encodeURIComponent(profile.user)}`;
  const hidden = profile.privacy ?? {};
  const nothing = profile.top.length === 0 && profile.playlists.length === 0 && profile.favorites.length === 0;
  return (
    <>
      <div className={ui.actions}>
        {profile.top.length > 0 && <PlayButtons songs={profile.top} />}
        {profile.me && <Link className={ui.pill} to="/settings"><Icon name="pencil" size={16} />Edit profile</Link>}
      </div>
      {profile.top.length > 0 && (
        <Section title="Top this month" action={hidden.hide_top ? <OnlyYou /> : undefined}>
          <SongList songs={profile.top} ranked />
        </Section>
      )}
      {profile.playlists.length > 0 && (
        <Section title="Playlists">
          <Shelf>
            {profile.playlists.map((list) => (
              <Link key={list.id} className={ui.card} to={`/playlist/${list.id}`}>
                <Picture src={coverUrl(list.cover, 300)} className={cx(ui.coverBig, ui.cardCover)} />
                <b>{list.name}</b><span>{plural(list.song_count, "song")}</span>
              </Link>
            ))}
          </Shelf>
        </Section>
      )}
      {profile.favorites.length > 0 && (
        <Section title="Favorites" action={<>
          {hidden.hide_favorites && <OnlyYou />}
          {profile.favorite_count > PREVIEW && <Link className={ui.pill} to={`${base}/favorites`}>{`Show all ${profile.favorite_count}`}</Link>}
        </>}>
          <SongList songs={profile.favorites} limit={PREVIEW} />
        </Section>
      )}
      {nothing && <Welcome title="Nothing to show yet">{profile.me
        ? <p>What you play most, your public playlists and your favorites show here for everyone on this server.</p>
        : <p>{`When ${profile.name} plays music, makes a playlist public or adds favorites, it shows here.`}</p>}</Welcome>}
    </>
  );
}

export function ProfileView() {
  const { name = "" } = useParams();
  const online = useOnline();
  useLiveListening();
  const { data: profile, error, isPending } = useQuery({ queryKey: ["person", name], queryFn: () => getPerson(name), enabled: online });
  let body;
  if (!online) body = <Empty>Profiles need a connection.</Empty>;
  else if (isPending) body = <Skeleton />;
  else if (error) body = <Empty>{error.message === "no such person" ? "There is nobody by that name on this server." : error.message}</Empty>;
  else body = <><ProfileHeader person={profile} /><ProfileBody profile={profile} /></>;
  return <><BackButton />{body}</>;
}

/** All of someone's favorites, newest first, as they were the last time they used Eco. */
export function PersonFavoritesView() {
  const { name = "" } = useParams();
  const online = useOnline();
  const person = useQuery({ queryKey: ["person", name], queryFn: () => getPerson(name), enabled: online });
  const songs = useQuery({ queryKey: ["person-favorites", name], queryFn: () => getPersonFavorites(name), enabled: online });
  let body;
  if (!online) body = <Empty>Profiles need a connection.</Empty>;
  else if (person.error || songs.error) body = <Empty>{(person.error ?? songs.error)!.message}</Empty>;
  else if (!person.data || !songs.data) body = <Skeleton />;
  else {
    body = (
      <DetailPage art={<PersonAvatar person={person.data} className={ui.avatarBig} />}
        info={<><h1>{`${person.data.name}'s favorites`}</h1><p>{plural(songs.data.length, "song")}, most recent first</p></>}
        actions={songs.data.length > 0 ? <PlayButtons songs={songs.data} /> : null}>
        {songs.data.length > 0 ? <SongList songs={songs.data} /> : <Empty>Nothing here.</Empty>}
      </DetailPage>
    );
  }
  return <><BackButton />{body}</>;
}
