// The people on this server and their profiles, read like an artist's page: what they play most this month (the order,
// never how often), their public playlists and their favorites. Each part shows unless its owner hid it, which the server
// decides; a profile needs a connection.
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { Link, useParams } from "react-router";
import { coverUrl, getPeople, getPerson, getPersonFavorites, personAvatarUrl, personBannerUrl } from "../lib/api";
import { hue, initials, plural } from "../lib/format";
import type { Person, Profile } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { BackButton, DetailPage, Empty, Section, Shelf, Skeleton, Welcome } from "../components/common";
import { Picture } from "../components/Cover";
import { Icon } from "../components/Icon";
import { PlayButtons, SongList } from "../components/songs";
import { useOnline } from "../stores/settings";

const PREVIEW = 10;
const HUE_FILL = "bg-[linear-gradient(135deg,hsl(var(--h)_55%_42%),hsl(calc(var(--h)+40)_60%_28%))]";

/** Someone's picture, or their initials on their own colour. */
export function PersonAvatar({ person, className = ui.avatar }: { person: Person; className?: string }) {
  if (person.avatar) return <img data-art="" className={cx(className, "object-cover")} src={personAvatarUrl(person.user, person.avatar)} alt="" loading="lazy" draggable={false} />;
  return <div data-art="" className={cx(className, ui.letters)} style={{ "--h": hue(person.user) } as CSSProperties}>{initials(person.name)}</div>;
}

const PersonCard = ({ person }: { person: Person }) => (
  <Link className={ui.cardArtist} to={`/people/${encodeURIComponent(person.user)}`}>
    <PersonAvatar person={person} />
    <b>{person.name}</b>
    <span>{person.me ? "You" : `@${person.user}`}</span>
  </Link>
);

export function PeopleView() {
  const online = useOnline();
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
  return (
    <header className="rise px-4 pt-1 wide:px-8">
      <div className={cx("w-full aspect-[5/2] wide:aspect-[9/2] max-h-72 overflow-hidden rounded-big", !person.banner && HUE_FILL)} style={{ "--h": hue(person.user) } as CSSProperties}>
        {person.banner ? <img className="size-full object-cover" src={personBannerUrl(person.user, person.banner)} alt="" draggable={false} /> : null}
      </div>
      {/* Only the picture rises over the cover's edge; the name starts below it */}
      <div className="flex items-start gap-4 px-3 wide:gap-5 wide:px-6">
        <PersonAvatar person={person} className="relative flex-none size-28 -mt-12 rounded-full bg-surface-2 shadow-[0_0_0_4px_var(--bg),0_18px_40px_rgb(0_0_0/.35)] wide:size-36 wide:-mt-16" />
        <div className="min-w-0 pt-3 wide:pt-4 [&_h1]:font-title [&_h1]:font-bold [&_h1]:leading-[1.03] [&_h1]:tracking-[-.04em] [&_h1]:text-[clamp(1.9rem,8cqi,2.6rem)] [&_h1]:wrap-anywhere wide:[&_h1]:text-[clamp(2.2rem,4.5cqi,3.6rem)] [&_p]:mt-1 [&_p]:text-muted">
          <h1>{person.name}</h1>
          <p>{person.me ? `@${person.user} · you` : `@${person.user}`}</p>
        </div>
      </div>
    </header>
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
