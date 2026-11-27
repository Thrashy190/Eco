// Jams: listening together with people on this server. A Jam's page shows what plays for everyone, who is in it and
// what comes next with who added it; the host chooses who may see it and control it. Starting one, and the Jams you may
// join, are on People.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { getJam, getPeople, listJams, toSong, username } from "../lib/api";
import { clock, plural } from "../lib/format";
import { jamPosition } from "../lib/jamclock";
import type { JamEntry, JamSummary, JamView, Person } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { BackButton, Empty, Section, Skeleton } from "../components/common";
import { PersonAvatar, SongCover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { configure, control, enterJam, exitJam, finishJam, invite, jamServerNow, removeEntry, setListenHere, startJam, useJam } from "../stores/jam";
import { useOnline } from "../stores/settings";
import { toast } from "../stores/ui";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The people of this server by username, to draw anyone in a Jam with their picture and name. */
function usePeopleByName(): (user: string) => Person {
  const { data } = useQuery({ queryKey: ["people"], queryFn: getPeople, staleTime: 60_000 });
  return useMemo(() => {
    const byName = new Map((data ?? []).map((p) => [p.user.toLowerCase(), p]));
    return (user: string) => byName.get(user.toLowerCase()) ?? { user, name: user };
  }, [data]);
}

/** The time now, again every second, for the bar of what plays. */
function useSecond(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const Faces = ({ users, personOf }: { users: string[]; personOf: (user: string) => Person }) => (
  <span className="flex items-center -space-x-2">
    {users.slice(0, 6).map((u) => <PersonAvatar key={u} person={personOf(u)} className="size-8 rounded-full bg-surface-2 shadow-[0_0_0_2px_var(--bg)] text-[.7rem]" />)}
    {users.length > 6 && <span className="grid place-items-center size-8 rounded-full bg-ghost text-[.72rem] font-bold shadow-[0_0_0_2px_var(--bg)]">{`+${users.length - 6}`}</span>}
  </span>
);

// ---------------- In People: the Jams you may join, and starting one ----------------

function JamCard({ jam, personOf }: { jam: JamSummary; personOf: (user: string) => Person }) {
  const navigate = useNavigate();
  const playing = jam.playing ? toSong(jam.playing) : null;
  return (
    <div className="flex-none w-[min(78vw,300px)] snap-start grid gap-2.5 p-4 rounded-card bg-glass-strong shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center justify-between gap-2">
        <Faces users={jam.members} personOf={personOf} />
        <span className="text-muted text-[.75rem] font-bold uppercase tracking-[.06em]">{jam.public ? "Public" : jam.invited ? "Invited" : "Private"}</span>
      </div>
      <div className="min-w-0">
        <b className="block truncate text-[1.05rem]">{jam.name}</b>
        <span className="block truncate text-muted text-[.85rem]">{`${personOf(jam.host).name} · ${plural(jam.members.length, "person", "people")}`}</span>
        <span className="block truncate text-[.85rem] mt-1">{playing ? `▶ ${playing.title} · ${playing.artist}` : "Nothing playing"}</span>
      </div>
      <button type="button" className={cx(jam.member ? ui.pill : ui.primary, "justify-center")}
        onClick={() => { if (jam.member) navigate(`/jam/${jam.id}`); else void enterJam(jam.id).then((joined) => { if (joined) navigate(`/jam/${jam.id}`); }); }}>
        {jam.member ? "Open" : "Join"}
      </button>
    </div>
  );
}

/** The Jams this person may join, at the top of People. */
export function JamsSection() {
  const personOf = usePeopleByName();
  const inJam = useJam((s) => s.view !== null);
  const { data } = useQuery({ queryKey: ["jams"], queryFn: listJams, refetchInterval: 10_000 });
  const jams = data?.jams ?? [];
  return (
    <Section title="Jams" action={<Link className={ui.pill} to="/jam/new"><Icon name="plus" size={16} />{inJam ? "Start another" : "Start a Jam"}</Link>}>
      {jams.length > 0
        ? <div className="flex gap-3 overflow-x-auto px-5 pb-2 snap-x no-scrollbar wide:px-8">{jams.map((j) => <JamCard key={j.id} jam={j} personOf={personOf} />)}</div>
        : <p className={ui.note}>No Jams right now. Start one: everyone you let in hears the same songs at the same time, and anyone in it can add some.</p>}
    </Section>
  );
}

/** On every page while in a Jam, a way back to it. */
export function JamBanner() {
  const view = useJam((s) => s.view);
  const { pathname } = useLocation();
  if (!view || pathname.startsWith(`/jam/${view.id}`)) return null;
  return (
    <Link to={`/jam/${view.id}`} className={cx(ui.banner, "text-text font-semibold hover:bg-surface-3")}>
      <Icon name="people" size={18} />
      <span className="min-w-0 flex-1 truncate">{`In ${view.name} · ${plural(view.members.length, "person", "people")}`}</span>
      <span className="inline-flex -scale-x-100"><Icon name="back" size={16} /></span>
    </Link>
  );
}

// ---------------- Starting one ----------------

export function NewJamView() {
  const navigate = useNavigate();
  const me = username();
  const [name, setName] = useState("");
  const [isPublic, setPublic] = useState(true);
  const [guests, setGuests] = useState(false);
  const [busy, setBusy] = useState(false);
  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const view = await startJam({ name, public: isPublic, guest_control: guests });
    setBusy(false);
    if (view) navigate(`/jam/${view.id}`, { replace: true });
  }
  const toggle = (on: boolean, set: (v: boolean) => void, label: string) => (
    <button type="button" className={ui.toggle} role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)} />
  );
  return (
    <>
      <BackButton />
      <header className={ui.hero}><h1>Start a Jam</h1><p>Everyone in it hears the same songs at the same time, and anyone in it can add some.</p></header>
      <form className="grid gap-4 px-5 pb-6 max-w-xl wide:px-8" onSubmit={(e) => void start(e)}>
        <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={`${me}'s Jam`} aria-label="Name of the Jam" />
        <div className={ui.group}>
          <div className={ui.setting}>
            <div className={ui.settingLabel}><b>Public</b><span>{isPublic ? "Anyone on this server can see it and join" : "Only the people you invite can see it and join"}</span></div>
            {toggle(isPublic, setPublic, "Public")}
          </div>
          <div className={ui.setting}>
            <div className={ui.settingLabel}><b>Everyone can control it</b><span>{guests ? "Anyone in it can pause, skip and change the queue" : "Only you pause, skip and change the queue; the others add songs and take out their own"}</span></div>
            {toggle(guests, setGuests, "Everyone can control it")}
          </div>
        </div>
        <button type="submit" className={cx(ui.primary, "justify-self-start")} disabled={busy}><Icon name="people" size={20} />Start</button>
      </form>
    </>
  );
}

// ---------------- A Jam ----------------

/** What plays for everyone, with a bar that moves with the Jam's time (LiveJam redraws every second). */
function NowInJam({ view, addedByName }: { view: JamView; addedByName: (user: string) => string }) {
  const entry = view.queue[view.current];
  if (!entry) return <p className={ui.note}>Nothing left to play. Add songs from anywhere: tap a song, or ⋯ ▸ Add to queue.</p>;
  const song = toSong(entry.song);
  const addedBy = same(entry.added_by, username()) ? "you" : addedByName(entry.added_by);
  const position = Math.min(jamPosition(view.playback, jamServerNow()), song.duration ?? Infinity);
  const percent = song.duration ? (position / song.duration) * 100 : 0;
  return (
    <div className="flex items-center gap-4 mx-4 p-3.5 rounded-card bg-glass-strong shadow-[inset_0_0_0_1px_var(--line)] wide:mx-8">
      <SongCover song={song} size={200} className="size-20 rounded-xl object-cover bg-surface-2 flex-none wide:size-24" />
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[1.1rem]">{song.title}</b>
        <span className="block truncate text-muted text-[.88rem]">{song.artist}</span>
        <span className="block truncate text-muted text-[.78rem] mt-0.5">{`Added by ${addedBy}`}{view.playback.paused ? " · Paused" : ""}</span>
        {song.duration ? (
          <div className="flex items-center gap-2 mt-2 text-muted text-[.72rem] tabular-nums">
            <span>{clock(position)}</span>
            <span className="relative flex-1 h-1 rounded-full bg-ghost overflow-hidden"><span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${percent}%` }} /></span>
            <span>{clock(song.duration)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Controls({ view, host }: { view: JamView; host: string }) {
  if (!view.can_control) return <p className={ui.note}>{`Only ${host} pauses and skips in this Jam. You can add songs and take out yours.`}</p>;
  const playing = Boolean(view.playback.entry) && !view.playback.paused;
  const round = "tap size-12 grid place-items-center rounded-full bg-ghost text-text active:scale-[.94] hover:bg-surface-3";
  return (
    <div className="flex items-center gap-3 px-5 wide:px-8">
      <button type="button" className={round} aria-label="Previous" onClick={() => void control("previous")}><Icon name="prev" size={20} /></button>
      <button type="button" className="tap size-14 grid place-items-center rounded-full bg-accent text-accent-ink active:scale-[.94]" aria-label={playing ? "Pause" : "Play"} onClick={() => void control(playing ? "pause" : "play")}>
        <Icon name={playing ? "pause" : "play"} size={24} />
      </button>
      <button type="button" className={round} aria-label="Next" onClick={() => void control("next")}><Icon name="next" size={20} /></button>
    </div>
  );
}

function QueueRow({ entry, view, place, nameOf }: { entry: JamEntry; view: JamView; place: number; nameOf: (user: string) => string }) {
  const song = toSong(entry.song);
  const mine = same(entry.added_by, username());
  const content = (
    <>
      <SongCover song={song} className={ui.cover} />
      <span className="min-w-0">
        <b className="block truncate">{song.title}</b>
        <span className="block truncate text-muted text-[.85rem]">{`${song.artist} · added by ${mine ? "you" : nameOf(entry.added_by)}`}</span>
      </span>
    </>
  );
  const row = "flex-1 min-w-0 flex items-center gap-3 text-left";
  return (
    <li className="flex items-center gap-3 min-h-15 px-5 py-1.5 wide:px-8">
      {view.can_control
        ? <button type="button" className={cx(row, "tap rounded-xl")} onClick={() => void control("jump", 0, entry.id)} aria-label={`Play ${song.title} now`}>{content}</button>
        : <div className={row}>{content}</div>}
      {(mine || view.can_control) && (
        <button type="button" className="tap size-9 grid place-items-center rounded-full text-muted hover:text-text hover:bg-ghost" aria-label={`Take ${song.title} out of the Jam`} onClick={() => void removeEntry(entry.id)}>
          <Icon name="close" size={18} />
        </button>
      )}
      <span className="sr-only">{place}</span>
    </li>
  );
}

/** What the host chooses: who may see the Jam and join it, and who may control it. */
function HostSettings({ view, personOf }: { view: JamView; personOf: (user: string) => Person }) {
  const { data: people } = useQuery({ queryKey: ["people"], queryFn: getPeople, staleTime: 60_000 });
  const others = (people ?? []).filter((p) => !p.me && !view.members.some((m) => same(m, p.user)));
  const set = (change: Partial<JamView>) => void configure({ name: view.name, public: view.public, guest_control: view.guest_control, ...change });
  return (
    <Section title="Your Jam">
      <div className={cx(ui.group, "mx-4 wide:mx-8")}>
        <div className={ui.setting}>
          <div className={ui.settingLabel}><b>Public</b><span>{view.public ? "Anyone on this server can see it and join" : "Only the people you invite"}</span></div>
          <button type="button" className={ui.toggle} role="switch" aria-checked={view.public} aria-label="Public" onClick={() => set({ public: !view.public })} />
        </div>
        <div className={ui.setting}>
          <div className={ui.settingLabel}><b>Everyone can control it</b><span>Pause, skip and change the queue</span></div>
          <button type="button" className={ui.toggle} role="switch" aria-checked={view.guest_control} aria-label="Everyone can control it" onClick={() => set({ guest_control: !view.guest_control })} />
        </div>
        {others.map((p) => {
          const invited = view.invited.some((u) => same(u, p.user));
          return (
            <div key={p.user} className={ui.setting}>
              <span className="flex items-center gap-3 min-w-0"><PersonAvatar person={personOf(p.user)} className="size-9 rounded-full bg-surface-2 text-[.75rem]" /><b className="truncate">{p.name}</b></span>
              <button type="button" className={ui.pill} data-on={invited || undefined} disabled={invited}
                onClick={() => void invite([p.user]).then((done) => { if (done) toast(`${p.name} can join now`); })}>
                {invited ? <><Icon name="check" size={16} />Invited</> : "Invite"}
              </button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function LiveJam({ view }: { view: JamView }) {
  const navigate = useNavigate();
  useSecond();
  const personOf = usePeopleByName();
  const listenHere = useJam((s) => s.listenHere);
  const host = same(view.host, username());
  const upcoming = view.queue.slice(view.current + 1);
  return (
    <>
      <header className={ui.hero}>
        <h1 className="wrap-anywhere">{view.name}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span>{`${view.public ? "Public" : "Private"} Jam · hosted by ${host ? "you" : personOf(view.host).name}`}</span>
          <Faces users={view.members} personOf={personOf} />
        </p>
      </header>
      <NowInJam view={view} addedByName={(u) => personOf(u).name} />
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <Controls view={view} host={personOf(view.host).name} />
        <label className="flex items-center gap-2.5 px-5 text-[.9rem] font-semibold wide:px-8">
          Play on this device
          <button type="button" className={ui.toggle} role="switch" aria-checked={listenHere} onClick={() => setListenHere(!listenHere)} />
        </label>
      </div>
      <Section title="Up next">
        {upcoming.length > 0
          ? <ol className="m-0 p-0 list-none">{upcoming.map((e, i) => <QueueRow key={e.id} entry={e} view={view} place={i + 1} nameOf={(u) => personOf(u).name} />)}</ol>
          : <p className={ui.note}>Add songs from anywhere: tap a song, or ⋯ ▸ Add to queue. Everyone here hears them.</p>}
      </Section>
      {host && <HostSettings view={view} personOf={personOf} />}
      <div className="flex flex-wrap gap-2.5 px-5 py-6 wide:px-8">
        {host
          ? <button type="button" className={ui.pill} onClick={() => { if (confirm(`End “${view.name}” for everyone?`)) void finishJam().then(() => navigate("/people")); }}><Icon name="close" size={16} />End the Jam</button>
          : <button type="button" className={ui.pill} onClick={() => void exitJam().then(() => navigate("/people"))}><Icon name="back" size={16} />Leave</button>}
      </div>
    </>
  );
}

/** A Jam you are not in: what it is, and joining it. */
function JamPreview({ id }: { id: string }) {
  const navigate = useNavigate();
  const personOf = usePeopleByName();
  const { data: view, error, isPending } = useQuery({ queryKey: ["jam", id], queryFn: () => getJam(id), refetchInterval: 10_000 });
  if (isPending) return <Skeleton rows={3} />;
  if (error) return <Empty>{error.message === "no such jam" ? "This Jam has ended, or it is private." : error.message}</Empty>;
  const entry = view.queue[view.current];
  return (
    <>
      <header className={ui.hero}>
        <h1 className="wrap-anywhere">{view.name}</h1>
        <p className="flex flex-wrap items-center gap-3"><span>{`Hosted by ${personOf(view.host).name}`}</span><Faces users={view.members} personOf={personOf} /></p>
      </header>
      <p className={ui.note}>{entry && !view.playback.paused ? `Playing ${entry.song.title} · ${entry.song.artist}` : "Nothing playing right now"}</p>
      <div className={ui.actions}>
        <button type="button" className={ui.primary} onClick={() => void enterJam(id).then((joined) => { if (joined) navigate(`/jam/${id}`, { replace: true }); })}>
          <Icon name="people" size={20} />Join
        </button>
      </div>
    </>
  );
}

export function JamPage() {
  const { id = "" } = useParams();
  const online = useOnline();
  const view = useJam((s) => s.view);
  let body;
  if (!online) body = <Empty>Jams need a connection.</Empty>;
  else if (view?.id === id) body = <LiveJam view={view} />;
  else body = <JamPreview id={id} />;
  return <><BackButton />{body}</>;
}
