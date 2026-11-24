// Statistics: what people play. An administrator sees the whole server (who listens to what) and can look at one person;
// anyone else sees their own numbers. The server decides which, on every request; the page only offers what it got.
// Charts are plain elements in the accent colour, one series each, with the numbers also written out.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { coverUrl, getStats } from "../lib/api";
import { hue, initials, plural } from "../lib/format";
import {
  ago, bucketLabel, change, changeLabel, count, hourLabel, listened, peakHour, perDay, RANGES, share, tallest, tickIndexes, validRange, WEEKDAYS,
} from "../lib/stats";
import type { LibraryStats, StatsRanked, StatsResponse, StatsSummary } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { artistPath } from "../components/ArtistLinks";
import { BackButton, Empty, Section, Skeleton, Welcome } from "../components/common";
import { ArtistAvatar, Picture } from "../components/Cover";
import { Icon } from "../components/Icon";

const RANGE_KEY = "eco.stats.range";
const readRange = () => { try { return validRange(localStorage.getItem(RANGE_KEY)); } catch { return validRange(null); } };
const saveRange = (range: string) => { try { localStorage.setItem(RANGE_KEY, range); } catch { /* storage unavailable */ } };

const PAD = "px-5 wide:px-8";
const CARD = "rounded-[22px] bg-glass-strong shadow-[inset_0_0_0_1px_var(--line)]";

// ---- Headline numbers ----

function Delta({ now, before }: { now: number; before?: number }) {
  const pct = change(now, before);
  if (pct === null) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[.78rem] font-bold text-muted">
      <span className={cx("inline-flex", pct < 0 && "rotate-180")} aria-hidden="true">{pct !== 0 && <Icon name="up" size={13} />}</span>
      {changeLabel(pct)}
    </span>
  );
}

function Tile({ label, value, detail, big }: { label: string; value: string; detail?: ReactNode; big?: boolean }) {
  return (
    <div className={cx(CARD, "grid content-start gap-1 p-4 min-w-0", big && "col-span-2")}>
      <span className="text-muted text-[.78rem] font-bold uppercase tracking-[.08em] truncate">{label}</span>
      <b className={cx("font-title font-bold tracking-[-.03em] leading-none tabular-nums truncate", big ? "text-[clamp(2.4rem,11cqi,3.4rem)]" : "text-[1.75rem]")}>{value}</b>
      {detail && <span className="min-h-[1.2em] text-muted text-[.82rem] truncate">{detail}</span>}
    </div>
  );
}

function Headline({ summary, everyone }: { summary: StatsSummary; everyone: boolean }) {
  const t = summary.totals;
  const p = summary.previous;
  return (
    <div className={cx(PAD, "stagger grid grid-cols-2 gap-2.5 @2xl:grid-cols-4 wide:gap-3")}>
      <Tile big label="Listened" value={listened(t.minutes)} detail={<Delta now={t.minutes} before={p?.minutes} />} />
      <Tile label="Plays" value={count(t.plays)} detail={<Delta now={t.plays} before={p?.plays} />} />
      {everyone
        ? <Tile label="Listeners" value={count(t.listeners)} detail={<Delta now={t.listeners} before={p?.listeners} />} />
        : <Tile label="A day" value={listened(perDay(t.minutes, t.active_days))} detail={t.active_days > 0 ? `on ${plural(t.active_days, "day")} with music` : undefined} />}
      <Tile label="Songs" value={count(t.songs)} detail={`${plural(t.artists, "artist")} · ${plural(t.albums, "album")}`} />
      <Tile label="First listens" value={count(t.first_listens)} detail="songs played for the first time" />
      {everyone && <Tile label="A day" value={listened(perDay(t.minutes, t.active_days))} detail={t.active_days > 0 ? `on ${plural(t.active_days, "day")} with music` : undefined} />}
      <Tile label="Genres" value={count(t.genres)} detail={t.no_genre > 0 ? `${share(t.no_genre, t.plays)}% of plays have none` : undefined} />
    </div>
  );
}

// ---- Charts ----

interface Bar { label: string; value: number; text: string }

/**
 * Vertical bars of one series. Pointing at a bar, or tapping it, writes its numbers in the line above the chart; the
 * total is there otherwise. Each bar is a whole column, so it is easy to hit even when it is short.
 */
function Bars({ bars, ticks, height = "h-40", summary }: { bars: Bar[]; ticks: number[]; height?: string; summary: string }) {
  const [active, setActive] = useState<number | null>(null);
  const top = tallest(bars.map((b) => b.value));
  const shown = active !== null ? bars[active] : null;
  return (
    <div className="grid gap-2" onPointerLeave={() => setActive(null)}>
      <p className="min-h-[1.3em] text-[.88rem] tabular-nums truncate" aria-live="polite">
        {shown ? <><b>{shown.label}</b><span className="text-muted">{` · ${shown.text}`}</span></> : <span className="text-muted">{summary}</span>}
      </p>
      <div className={cx(height, "relative flex items-end gap-0.5 border-b border-line")} role="list">
        {/* A faint line at the top value, the only grid line: enough to read the bars against */}
        <span className="absolute inset-x-0 top-0 border-t border-dashed border-line pointer-events-none" aria-hidden="true" />
        {bars.map((bar, i) => (
          <button key={i} type="button" role="listitem" aria-label={`${bar.label}: ${bar.text}`}
            className="group/bar relative flex-1 min-w-0 h-full flex items-end cursor-default outline-none"
            onPointerEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)}>
            <span data-on={active === i || undefined}
              className={cx("block w-full rounded-t-[4px] bg-accent transition-[opacity,height] duration-300",
                active !== null && active !== i ? "opacity-45" : "opacity-100", bar.value === 0 && "opacity-0!")}
              style={{ height: `${Math.max(bar.value > 0 ? 3 : 0, (bar.value / top) * 100)}%` }} />
          </button>
        ))}
      </div>
      <div className="relative h-4 text-muted text-[.72rem] tabular-nums" aria-hidden="true">
        {ticks.map((i) => (
          <span key={i} className={cx("absolute top-0 whitespace-nowrap", i === 0 ? "left-0" : i === bars.length - 1 ? "right-0" : "-translate-x-1/2")}
            style={i === 0 || i === bars.length - 1 ? undefined : { left: `${((i + 0.5) / bars.length) * 100}%` }}>{bars[i].label.replace("Week of ", "")}</span>
        ))}
      </div>
    </div>
  );
}

function Timeline({ summary }: { summary: StatsSummary }) {
  const bars = summary.timeline.map((b) => ({ label: bucketLabel(b.start, summary.step), value: b.minutes, text: `${listened(b.minutes)} · ${plural(b.plays, "play")}` }));
  const each = summary.step === "day" ? "a day" : summary.step === "week" ? "a week" : "a month";
  return (
    <Section title="Listening over time">
      <div className={PAD}>
        <div className={cx(CARD, "p-4")}>
          {bars.length === 0
            ? <p className="text-muted text-[.9rem]">Imported history has no dates, so it is not on the chart.</p>
            : <Bars bars={bars} ticks={tickIndexes(bars.length)} summary={`Minutes ${each}`} />}
        </div>
      </div>
    </Section>
  );
}

function WhenPeopleListen({ summary, everyone }: { summary: StatsSummary; everyone: boolean }) {
  const hours = summary.hours.map((n, h) => ({ label: hourLabel(h), value: n, text: plural(n, "play") }));
  const days = summary.weekdays.map((n, d) => ({ label: WEEKDAYS[d], value: n, text: plural(n, "play") }));
  const peak = peakHour(summary.hours);
  return (
    <Section title={everyone ? "When people listen" : "When you listen"}>
      <div className={cx(PAD, "grid gap-2.5 @4xl:grid-cols-[2fr_1fr] wide:gap-3")}>
        <div className={cx(CARD, "p-4")}><Bars bars={hours} ticks={[0, 6, 12, 18, 23]} height="h-28" summary={peak ? `Busiest at ${peak}` : "Plays by hour"} /></div>
        <div className={cx(CARD, "p-4")}><Bars bars={days} ticks={[0, 1, 2, 3, 4, 5, 6]} height="h-28" summary="Plays by day of the week" /></div>
      </div>
    </Section>
  );
}

// ---- Rankings ----

function PlaysLabel({ item }: { item: StatsRanked }) {
  return (
    <span className="grid justify-items-end text-[.82rem] tabular-nums flex-none">
      <b>{plural(item.plays, "play")}</b>
      <span className="text-muted">{listened(item.minutes)}</span>
    </span>
  );
}

/** A thin bar under a row's text, its length the share of the first row, so a ranking reads at a glance. */
const Meter = ({ value, top }: { value: number; top: number }) => (
  <span className="block h-1 mt-1 rounded-full bg-ghost overflow-hidden" aria-hidden="true">
    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (value / Math.max(1, top)) * 100)}%` }} />
  </span>
);

function Ranking({ title, items, everyone, art, link }: {
  title: string; items: StatsRanked[]; everyone: boolean;
  art: (item: StatsRanked) => ReactNode; link?: (item: StatsRanked) => string | undefined;
}) {
  const navigate = useNavigate();
  const top = items[0]?.plays ?? 1;
  return (
    <Section title={title}>
      {items.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <ol className={ui.rows}>
          {items.map((item, i) => {
            const to = link?.(item);
            return (
              <li key={`${item.id ?? item.name}-${i}`} className={cx(ui.row, !to && "cursor-default")} onClick={to ? () => navigate(to) : undefined}>
                <span className={ui.num}>{i + 1}</span>
                {art(item)}
                <div className={ui.text}>
                  <b>{item.name}</b>
                  <span>{[item.artist, everyone && item.listeners > 0 ? plural(item.listeners, "listener") : ""].filter(Boolean).join(" · ")}</span>
                  <Meter value={item.plays} top={top} />
                </div>
                <PlaysLabel item={item} />
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

/** Genres as horizontal bars, with their share of the plays written beside them. */
function GenreBars({ title, items, total, unit, note }: { title: string; items: StatsRanked[]; total: number; unit: string; note?: ReactNode }) {
  const top = items[0]?.plays ?? 1;
  return (
    <Section title={title}>
      {items.length === 0 ? <Empty>{note ?? "No genres yet."}</Empty> : (
        <div className={PAD}>
          <ul className={cx(CARD, "grid gap-3 p-4")}>
            {items.map((g) => (
              <li key={g.name} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3 text-[.9rem]">
                  <b className="truncate font-[650]">{g.name}</b>
                  <span className="text-muted tabular-nums flex-none">{`${plural(g.plays, unit)} · ${share(g.plays, total)}%`}</span>
                </div>
                <span className="block h-2 rounded-full bg-ghost overflow-hidden" aria-hidden="true">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (g.plays / Math.max(1, top)) * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>
          {note && <p className="text-muted text-[.85rem] pt-2.5">{note}</p>}
        </div>
      )}
    </Section>
  );
}

// ---- People ----

const Letters = ({ name }: { name: string }) => (
  <div data-art="" className={cx(ui.avatarSmall, ui.letters, "text-[.95rem]!")} style={{ "--h": hue(name) } as React.CSSProperties}>{initials(name)}</div>
);

function Listeners({ data, onPick }: { data: StatsResponse; onPick: (user: string) => void }) {
  const people = data.summary.listeners ?? [];
  const top = people[0]?.minutes ?? 1;
  return (
    <Section title="Who listens to what">
      {people.length === 0 ? <Empty>Nobody has played anything in this period.</Empty> : (
        <ul className={ui.rows}>
          {people.map((p) => (
            <li key={p.user} className={ui.row} onClick={() => onPick(p.user)}>
              <Letters name={p.user} />
              <div className={ui.text}>
                <b>{p.user}</b>
                <span>{[p.top_artist, p.top_genre].filter(Boolean).join(" · ") || plural(p.songs, "song")}</span>
                {p.top_song && <span>{`Most played: ${p.top_song}`}</span>}
                <Meter value={p.minutes} top={top} />
              </div>
              <span className="grid justify-items-end text-[.82rem] tabular-nums flex-none">
                <b>{listened(p.minutes)}</b>
                <span className="text-muted">{ago(p.last) || plural(p.plays, "play")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Recent({ summary, everyone }: { summary: StatsSummary; everyone: boolean }) {
  if (summary.recent.length === 0) return null;
  return (
    <Section title="Just played">
      <ul className={ui.rows}>
        {summary.recent.slice(0, 12).map((r) => (
          <li key={`${r.at}-${r.id}-${r.user}`} className={cx(ui.row, "cursor-default")}>
            <Picture src={coverUrl(r.cover, 96)} />
            <div className={ui.text}><b>{r.title}</b><span>{r.artist}</span></div>
            <span className="grid justify-items-end text-[.82rem] flex-none">
              {everyone && <b>{r.user}</b>}
              <span className="text-muted">{ago(r.at)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Library({ library, admin }: { library: LibraryStats; admin: boolean }) {
  const missing = library.songs - library.with_genre;
  return (
    <>
      <Section title="The library">
        <div className={cx(PAD, "stagger grid grid-cols-2 gap-2.5 @2xl:grid-cols-4 wide:gap-3")}>
          <Tile label="Songs" value={count(library.songs)} />
          <Tile label="Albums" value={count(library.albums)} />
          <Tile label="Artists" value={count(library.artists)} />
          <Tile label="Of music" value={`${count(library.hours)} h`} />
        </div>
      </Section>
      <GenreBars title="Genres in the library" items={library.genres} total={library.songs} unit="song"
        note={missing > 0 ? (
          <>{`${share(missing, library.songs)}% of songs (${count(missing)}) have no genre.`}{admin && <> <Link className={ui.link} to="/cleanup">Add genres in Library clean-up</Link></>}</>
        ) : undefined} />
    </>
  );
}

// ---- The page ----

function Period({ summary }: { summary: StatsSummary }) {
  const since = summary.since ? `Eco has counted plays since ${new Date(summary.since).toLocaleDateString()}.` : "";
  const text = summary.with_history ? `${since} Before that, what each person played comes from Navidrome's play counts, which have no dates.`.trim() : since;
  return text ? <p className={ui.note}>{text}</p> : null;
}

export function Stats() {
  const [range, setRange] = useState(readRange);
  const [user, setUser] = useState("");
  const { data, error, isPending, isFetching } = useQuery({
    queryKey: ["stats", range, user],
    queryFn: ({ signal }) => getStats(range, user, signal),
    placeholderData: keepPreviousData, // changing the period keeps the page in place
    staleTime: 30_000,
  });
  const pickRange = (value: string) => { setRange(value); saveRange(value); };
  const everyone = data ? data.admin && data.user === "" : false;
  const summary = data?.summary;
  const people = data?.people ?? [];

  return (
    <>
      <BackButton />
      <header className={ui.heroCompact}>
        <h1>Statistics</h1>
        <p>{!data ? "Counting…" : everyone ? "What everyone plays on this server" : data.admin ? `What ${data.user} plays` : "What you play"}</p>
      </header>
      <div className={ui.segments} role="group" aria-label="Period">
        {RANGES.map(([value, label]) => <button key={value} type="button" className={ui.segment} data-on={range === value || undefined} onClick={() => pickRange(value)}>{label}</button>)}
      </div>
      {data?.admin && people.length > 0 && (
        <div className={ui.segments} role="group" aria-label="Whose numbers">
          <button type="button" className={ui.segment} data-on={user === "" || undefined} onClick={() => setUser("")}><Icon name="user" size={15} /> Everyone</button>
          {people.map((name) => <button key={name} type="button" className={ui.segment} data-on={user.toLowerCase() === name.toLowerCase() || undefined} onClick={() => setUser(name)}>{name}</button>)}
        </div>
      )}
      {isPending && <Skeleton rows={4} />}
      {error && <Empty>{error.message}</Empty>}
      {data && summary && (
        <div className={cx("transition-opacity duration-200", isFetching && "opacity-70")}>
          {summary.totals.plays === 0
            ? (
              <Welcome title="Nothing counted yet">
                <p>{summary.since
                  ?"No plays in this period. Try a longer one."
                  : "Eco counts each song played to the half here, on the TV, and in any Subsonic app connected to Eco. With “Count my plays” on in Settings, what you play shows up here."}</p>
              </Welcome>
            )
            : (
              <>
                <Headline summary={summary} everyone={everyone} />
                <Period summary={summary} />
                {summary.timeline.length > 0 && <Timeline summary={summary} />}
                {everyone && <Listeners data={data} onPick={setUser} />}
                <div className="@4xl:grid @4xl:grid-cols-2 @4xl:items-start">
                  <Ranking title="Top songs" items={summary.songs} everyone={everyone} art={(s) => <Picture src={coverUrl(s.cover, 96)} />} />
                  <Ranking title="Top artists" items={summary.artists} everyone={everyone} link={(a) => artistPath(a.name)}
                    art={(a) => <ArtistAvatar name={a.name} cover={a.cover} size={96} className={ui.avatarSmall} />} />
                </div>
                <div className="@4xl:grid @4xl:grid-cols-2 @4xl:items-start">
                  <GenreBars title={everyone ? "Favorite genres" : "Your genres"} items={summary.genres} total={summary.totals.plays} unit="play"
                    note={summary.totals.no_genre > 0 && summary.genres.length === 0 ? "None of these songs has a genre yet." : undefined} />
                  <Ranking title="Top albums" items={summary.albums} everyone={everyone} link={(a) => (a.id ? `/album/${a.id}` : undefined)}
                    art={(a) => <Picture src={coverUrl(a.cover, 96)} />} />
                </div>
                {summary.hours.some((n) => n > 0) && <WhenPeopleListen summary={summary} everyone={everyone} />}
                <Recent summary={summary} everyone={everyone} />
              </>
            )}
          {data.library && everyone && <Library library={data.library} admin={data.admin} />}
          <p className={cx(ui.note, "pt-6 pb-10")}>Minutes add up the length of each song played past its half. Apps connected straight to Navidrome instead of Eco are not counted.</p>
        </div>
      )}
    </>
  );
}
