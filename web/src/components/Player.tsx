// On a phone, the mini player above the tab bar and the full-screen player that opens from it. On a tablet, a capsule
// floating over the page that opens the same full-screen player. On a computer, the deck: a column of its own with what
// is playing and what comes next. All of them show this device or, when another is being controlled, that
// one; the controls go wherever the music is (see stores/connect.ts).
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { hasCover, songCover } from "../lib/api";
import { clock } from "../lib/format";
import { dominantColor } from "../lib/image";
import { useRoomy, useWide } from "../lib/media";
import type { Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { useShown } from "../stores/connect";
import { toggleFavorite, useStarred } from "../stores/favorites";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { removeOffline, saveOffline } from "../stores/saving";
import { setCoverColor, setSettings, useSettings } from "../stores/settings";
import { ArtistLinks } from "./ArtistLinks";
import { SongCover } from "./Cover";
import { DeviceButton, openDevicePicker } from "./Devices";
import { Icon, Ring } from "./Icon";
import { songMenu } from "./songs";

const NEUTRAL = "60 60 70";

const ghost = "tap relative size-13 grid place-items-center rounded-full text-text opacity-85 data-on:opacity-100 data-on:text-accent data-on:after:content-[''] data-on:after:absolute data-on:after:bottom-1.5 data-on:after:size-1 data-on:after:rounded-full data-on:after:bg-accent data-[mode=one]:data-on:before:content-['1'] data-[mode=one]:data-on:before:absolute data-[mode=one]:data-on:before:top-3 data-[mode=one]:data-on:before:right-3.5 data-[mode=one]:data-on:before:text-[.62rem] data-[mode=one]:data-on:before:font-extrabold";
const ghostSmall = "tap relative size-9 grid place-items-center rounded-full text-muted hover:text-text data-on:text-accent data-on:after:content-[''] data-on:after:absolute data-on:after:bottom-0.5 data-on:after:size-1 data-on:after:rounded-full data-on:after:bg-accent data-[mode=one]:data-on:before:content-['1'] data-[mode=one]:data-on:before:absolute data-[mode=one]:data-on:before:top-1.25 data-[mode=one]:data-on:before:right-1.5 data-[mode=one]:data-on:before:text-[.62rem] data-[mode=one]:data-on:before:font-extrabold";
const ghostWide = "tap flex-1 h-11.5 inline-flex items-center justify-center gap-2 rounded-full bg-ghost text-text font-bold text-[.9rem] hover:brightness-125";
const heart = "tap flex-none size-11.5 grid place-items-center rounded-full bg-ghost text-text data-on:text-love data-on:[&_svg]:animate-pop";
const heartPlain = "tap flex-none size-9 grid place-items-center rounded-full text-muted hover:text-text data-on:text-love data-on:[&_svg]:animate-pop";
const lines = "min-w-0 grid [&>*]:truncate [&>b]:font-[650] [&>span]:text-muted [&>span]:text-[.82rem]";
const onDevice = "text-accent! font-[650]";
const glass = "bg-glass-strong backdrop-blur-2xl backdrop-saturate-150 shadow-[0_24px_60px_rgb(0_0_0/.3),inset_0_0_0_1px_var(--line)]";

/** Drag to change the volume. Hidden for iPhones, where only the hardware buttons can. */
function VolumeSlider({ volume, className }: { volume: number; className?: string }) {
  return (
    <label className={cx("flex items-center gap-2.5 text-muted", className)}>
      <Icon name={volume === 0 ? "volume-off" : "volume"} size={20} />
      <input type="range" className="range flex-1 min-w-0" style={{ "--fill": volume } as React.CSSProperties} min="0" max="100" value={Math.round(volume * 100)} aria-label="Volume" onChange={(e) => player.setVolume(Number(e.target.value) / 100)} />
    </label>
  );
}

function Hairline() {
  const ratio = player.useTime((t) => (t.length ? Math.min(t.position / t.length, 1) : 0));
  return <i className="absolute inset-x-5 bottom-0.5 h-0.5 rounded-full bg-accent origin-left" style={{ transform: `scaleX(${ratio})` }} />;
}

function SeekBar({ inline }: { inline?: boolean }) {
  const position = player.useTime((t) => t.position);
  const length = player.useTime((t) => t.length);
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? (length ? (position / length) * 1000 : 0);
  const finish = () => { if (dragging !== null) { player.seek((dragging / 1000) * length); setDragging(null); } };
  const at = clock(dragging !== null ? (dragging / 1000) * length : position);
  const slider = <input type="range" className={cx("range", inline && "flex-1 min-w-0")} style={{ "--fill": shown / 1000 } as React.CSSProperties} min="0" max="1000" value={Math.round(shown)} aria-label="Position" onChange={(e) => setDragging(Number(e.target.value))} onPointerUp={finish} onKeyUp={finish} />;
  const time = "text-muted text-[.75rem] tabular-nums min-w-[2.6em]";
  if (inline) return <div className="flex items-center gap-2 flex-1 min-w-0"><span className={cx(time, "text-right")}>{at}</span>{slider}<span className={time}>{clock(length)}</span></div>;
  return (
    <div>
      {slider}
      <div className="flex justify-between text-muted text-[.8rem] tabular-nums"><span>{at}</span><span>{clock(length)}</span></div>
    </div>
  );
}

function Queue({ upcoming, index }: { upcoming: Song[]; index: number }) {
  return (
    <ul className={ui.rowsPlain}>
      {upcoming.length === 0 && <li className={ui.empty}>The queue is empty</li>}
      {upcoming.map((next, k) => (
        <li className={ui.rowCompact} key={`${next.id}-${k}`} onClick={() => player.jumpTo(index + 1 + k)}>
          <div className={ui.text}><b>{next.title}</b><span>{next.artist}</span></div>
          <span className={ui.time}>{next.duration ? clock(next.duration) : ""}</span>
        </li>
      ))}
    </ul>
  );
}

/** The colour of a cover. Only asked for when it shows: a closed player must not spend the connection on a picture every song. */
function useTint(art: string, wanted: boolean): string {
  const [tint, setTint] = useState(NEUTRAL);
  useEffect(() => {
    if (!wanted) return;
    if (!art) { setTint(NEUTRAL); return; }
    const probe = new Image();
    probe.onload = () => setTint(dominantColor(probe) ?? NEUTRAL);
    probe.src = art;
    return () => { probe.onload = null; };
  }, [art, wanted]);
  return tint;
}

function NowPlaying({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const shown = useShown();
  const { song, playing, loading, shuffle, repeat, speed, upcoming, index } = shown;
  const starred = useStarred(song);
  const tintOn = useSettings((s) => s.tint);
  offline.useOfflineVersion();

  const art = song && hasCover(song) ? songCover(song, 600) : "";
  const tint = useTint(art, open);

  // Mounted only while visible, but kept for the length of the slide-down
  const [visible, setVisible] = useState(false);
  const [raised, setRaised] = useState(false);
  useEffect(() => {
    if (open) {
      setVisible(true);
      const frame = requestAnimationFrame(() => setRaised(true));
      return () => cancelAnimationFrame(frame);
    }
    setRaised(false);
    const timer = setTimeout(() => setVisible(false), 220);
    return () => clearTimeout(timer);
  }, [open]);

  if (!song || !visible) return null;
  const spoken = player.isSpoken(song);
  const saved = offline.isSaved(song.id);
  const column = "w-full max-w-110";
  return (
    <section role="dialog" aria-label="Now playing" style={{ "--tint": tintOn ? tint : NEUTRAL } as React.CSSProperties}
      className={cx(
        "fixed inset-0 z-50 flex flex-col items-center gap-4.5 overflow-y-auto px-6 pt-[calc(var(--safe-top)+10px)] pb-[calc(var(--safe-bottom)+28px)] [background:radial-gradient(130%_75%_at_50%_12%,rgb(var(--tint)/.8),transparent_72%),var(--bg)] transition-transform duration-240 ease-snap",
        "wide:grid wide:grid-cols-[minmax(0,440px)_minmax(0,400px)] wide:grid-rows-[auto_minmax(0,1fr)] wide:justify-center wide:items-start wide:gap-x-12 wide:gap-y-3 wide:overflow-hidden wide:pt-10 wide:[background:radial-gradient(90%_80%_at_20%_30%,rgb(var(--tint)/.75),transparent_70%),var(--bg)]",
        raised ? "translate-y-0" : "translate-y-full",
      )}>
      <button className="w-11 h-9 self-start grid place-items-center -ml-2 text-text wide:col-span-full" aria-label="Minimise" onClick={onClose}><Icon name="down" size={28} /></button>
      <div className="contents wide:flex wide:flex-col wide:gap-4.5 wide:min-h-0 wide:max-h-full wide:overflow-y-auto wide:no-scrollbar">
        {art
          ? <img key={art} src={art} alt="" className="w-[min(82vw,44vh,420px)] aspect-square rounded-big object-cover bg-surface-2 mx-auto mt-1 flex-none animate-art-in shadow-[0_24px_60px_rgb(var(--tint)/.55),0_4px_16px_rgb(0_0_0/.4)] wide:w-[min(40vw,54vh,420px)]" />
          : <div className="invisible w-[min(82vw,44vh,420px)] aspect-square mx-auto flex-none" />}
        <div className={cx("grid gap-0.5", column)}>
          <h2 className="font-title text-[1.7rem] font-bold tracking-[-.03em] leading-[1.1] wrap-anywhere wide:text-[2rem]">{song.title}</h2>
          <ArtistLinks className="text-muted font-semibold justify-self-start" name={song.artist} id={song.artistId} />
        </div>
        <div className={column}><SeekBar /></div>
        <div className={cx("flex items-center justify-between", column)}>
          <button className={ghost} data-on={shuffle || undefined} aria-label="Shuffle" aria-pressed={shuffle} onClick={player.toggleShuffle}><Icon name="shuffle" /></button>
          <button className={ghost} aria-label="Previous" onClick={player.previous}><Icon name="prev" size={30} /></button>
          <button className="tap size-19 grid place-items-center rounded-full bg-accent text-accent-ink shadow-[0_12px_32px_rgb(var(--glow)/.35)] active:scale-[.96]" aria-label={playing ? "Pause" : "Play"} onClick={player.toggle}>{loading ? <Ring percent={-1} size={24} /> : <Icon name={playing ? "pause" : "play"} size={24} />}</button>
          <button className={ghost} aria-label="Next" onClick={() => player.next()}><Icon name="next" size={30} /></button>
          <button className={ghost} data-on={repeat !== "off" || undefined} data-mode={repeat} aria-label="Repeat" onClick={player.cycleRepeat}><Icon name="repeat" /></button>
        </div>
        {shown.canVolume && <VolumeSlider volume={shown.volume} className={column} />}
        <DeviceButton name={shown.deviceName} />
        <div className={cx("flex gap-2.5", column)}>
          {!spoken && <button className={heart} data-on={starred || undefined} aria-label="Favorite" aria-pressed={starred} onClick={() => void toggleFavorite(song)}><Icon name={starred ? "heart-fill" : "heart"} /></button>}
          {spoken && <button className={ghostWide} aria-label="Playback speed" onClick={player.cycleSpeed}>{`${speed}×`}</button>}
          <button className={ghostWide} onClick={() => void (saved ? removeOffline(song) : saveOffline(song))}><Icon name={saved ? "check" : "offline"} size={20} />{saved ? "Saved offline" : "Save offline"}</button>
          <button className={ghostWide} onClick={() => songMenu(song, navigate)}><Icon name="more" size={20} />More</button>
        </div>
      </div>
      <div className="contents wide:block wide:min-h-0 wide:max-h-full wide:overflow-y-auto wide:no-scrollbar">
        <h3 className="text-[.8rem] uppercase tracking-[.08em] text-muted mt-2">Up next</h3>
        <Queue upcoming={upcoming} index={index} />
      </div>
    </section>
  );
}

/** Where the deck or the full-screen player is not open: the essentials in a capsule floating over the page. */
function Capsule({ onOpen, expanded }: { onOpen: () => void; expanded: boolean }) {
  const shown = useShown();
  const { song, playing, loading, isRemote, deviceName } = shown;
  const starred = useStarred(song);
  if (!song) return null;
  const spoken = player.isSpoken(song);
  return (
    <footer aria-label="Player" className={cx("absolute z-30 inset-x-0 mx-auto bottom-[calc(var(--safe-bottom)+20px)] w-[min(860px,calc(100%-40px))] flex items-center gap-2 h-18 pl-2 pr-3 rounded-[26px] animate-slide-up", glass, isRemote && "shadow-[inset_0_0_0_1.5px_var(--accent)]")}>
      <button type="button" data-open-player="" className="flex-none rounded-[18px] overflow-hidden" aria-label="Now playing" onClick={onOpen}><SongCover song={song} size={96} className="size-14 object-cover bg-surface-2" /></button>
      <div className={cx(lines, "w-[clamp(110px,20%,200px)] flex-none ml-1")}>
        <b title={song.title}>{song.title}</b>
        {isRemote ? <span className={onDevice}>{`Playing on ${deviceName}`}</span> : <ArtistLinks name={song.artist} id={song.artistId} className="text-muted text-[.82rem]" />}
      </div>
      {!spoken && <button className={heartPlain} data-on={starred || undefined} aria-label="Favorite" aria-pressed={starred} onClick={() => void toggleFavorite(song)}><Icon name={starred ? "heart-fill" : "heart"} size={20} /></button>}
      <button className={ghostSmall} aria-label="Previous" onClick={player.previous}><Icon name="prev" size={20} /></button>
      <button className="tap flex-none size-11 grid place-items-center rounded-full bg-text text-bg hover:scale-105" aria-label={playing ? "Pause" : "Play"} onClick={player.toggle}>{loading ? <Ring percent={-1} size={20} /> : <Icon name={playing ? "pause" : "play"} size={18} />}</button>
      <button className={ghostSmall} aria-label="Next" onClick={() => player.next()}><Icon name="next" size={20} /></button>
      <SeekBar inline />
      {spoken && <button className={ghostSmall} aria-label="Playback speed" onClick={player.cycleSpeed}>{`${shown.speed}×`}</button>}
      <button className={ghostSmall} data-on={isRemote || undefined} aria-label="Choose a device" title="Choose a device" onClick={openDevicePicker}><Icon name="devices" size={20} /></button>
      {shown.canVolume && <VolumeSlider volume={shown.volume} className="hidden min-[1000px]:flex w-28 flex-none" />}
      <button className={ghostSmall} aria-label={expanded ? "Show the deck" : "Open the player"} title="Now playing" onClick={onOpen}><Icon name="panel" size={20} /></button>
    </footer>
  );
}

/** The deck, while something is playing: the song itself and every control, with what comes next beneath. */
function DeckNow({ song }: { song: Song }) {
  const navigate = useNavigate();
  const shown = useShown();
  const { playing, loading, shuffle, repeat, upcoming, index, isRemote, deviceName } = shown;
  const starred = useStarred(song);
  offline.useOfflineVersion();
  const spoken = player.isSpoken(song);
  const saved = offline.isSaved(song.id);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-none px-4 pb-2">
        <SongCover song={song} size={600} className="block mx-auto w-full max-w-[min(100%,38dvh)] h-auto aspect-square rounded-[22px] object-cover bg-surface-2 shadow-[0_20px_50px_rgb(var(--tint)/.4),0_4px_14px_rgb(0_0_0/.3)] transition-shadow duration-700" />
        <div className="flex items-start gap-2 mt-3.5">
          <div className="flex-1 min-w-0 grid gap-0.5">
            <h2 className="font-title text-[1.4rem] font-bold tracking-[-.025em] leading-[1.12] line-clamp-2" title={song.title}>{song.title}</h2>
            {isRemote ? <span className={onDevice}>{`Playing on ${deviceName}`}</span> : <ArtistLinks className="truncate text-muted font-medium text-[.92rem]" name={song.artist} id={song.artistId} />}
          </div>
          {!spoken && <button className={heartPlain} data-on={starred || undefined} aria-label="Favorite" aria-pressed={starred} onClick={() => void toggleFavorite(song)}><Icon name={starred ? "heart-fill" : "heart"} size={22} /></button>}
          <button className={ghostSmall} aria-label="More" onClick={() => songMenu(song, navigate)}><Icon name="more" size={20} /></button>
        </div>
        <div className="mt-1"><SeekBar /></div>
        <div className="flex items-center justify-between">
          <button className={ghostSmall} data-on={shuffle || undefined} aria-label="Shuffle" aria-pressed={shuffle} onClick={player.toggleShuffle}><Icon name="shuffle" size={18} /></button>
          <button className={ghostSmall} aria-label="Previous" onClick={player.previous}><Icon name="prev" size={24} /></button>
          <button className="tap flex-none size-14 grid place-items-center rounded-full bg-accent text-accent-ink shadow-[0_10px_28px_rgb(var(--glow)/.3)] hover:scale-105 active:scale-[.96]" aria-label={playing ? "Pause" : "Play"} onClick={player.toggle}>{loading ? <Ring percent={-1} size={22} /> : <Icon name={playing ? "pause" : "play"} size={22} />}</button>
          <button className={ghostSmall} aria-label="Next" onClick={() => player.next()}><Icon name="next" size={24} /></button>
          <button className={ghostSmall} data-on={repeat !== "off" || undefined} data-mode={repeat} aria-label="Repeat" onClick={player.cycleRepeat}><Icon name="repeat" size={18} /></button>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <button className={ghostSmall} data-on={isRemote || undefined} aria-label="Choose a device" title={isRemote ? `Playing on ${deviceName}` : "Choose a device"} onClick={openDevicePicker}><Icon name="devices" size={19} /></button>
          <button className={ghostSmall} data-on={saved || undefined} aria-label={saved ? "Remove from this device" : "Save offline"} title={saved ? "Saved on this device" : "Save offline"} onClick={() => void (saved ? removeOffline(song) : saveOffline(song))}><Icon name={saved ? "check" : "offline"} size={19} /></button>
          {spoken && <button className={ghostSmall} aria-label="Playback speed" onClick={player.cycleSpeed}>{`${shown.speed}×`}</button>}
          {shown.canVolume && <VolumeSlider volume={shown.volume} className="flex-1 min-w-0 pl-1" />}
        </div>
      </div>
      <div className="flex-1 min-h-24 overflow-y-auto px-2 pb-3 border-t border-line [scrollbar-width:thin]">
        <h3 className="px-2 pt-3 pb-1 text-[.8rem] font-semibold text-muted">Up next</h3>
        <Queue upcoming={upcoming} index={index} />
      </div>
    </div>
  );
}

/** A column of its own beside the page, on a screen with room, while something is playing. */
function Deck({ song, onClose }: { song: Song; onClose: () => void }) {
  return (
    <aside aria-label="Now playing" className={cx("relative z-10 flex flex-col w-[clamp(320px,27vw,392px)] min-h-0 rounded-[28px] overflow-hidden", glass)}>
      <header className="flex-none flex items-center gap-1.5 pl-5 pr-2 pt-2 pb-1">
        <b className="flex-1 min-w-0 truncate font-semibold text-[.88rem] text-muted" title={song.album}>{song.album || "Now playing"}</b>
        <button type="button" className={ui.iconButton} aria-label="Hide the deck" onClick={onClose}><span className="inline-flex -rotate-90"><Icon name="down" size={20} /></span></button>
      </header>
      <DeckNow song={song} />
    </aside>
  );
}

export function Player() {
  const shown = useShown();
  const { song, playing, loading, isRemote, deviceName } = shown;
  const location = useLocation();
  const wide = useWide();
  const roomy = useRoomy();
  const panel = useSettings((s) => s.nowPanel);
  const [open, setOpen] = useState(false);
  const deck = wide && roomy && panel && Boolean(song);
  const capsule = wide && !deck && Boolean(song);

  // Any navigation (Go to artist, Go to album, a link) means the player must get out of the way
  useEffect(() => setOpen(false), [location.key]);
  const hasSong = Boolean(song);
  useEffect(() => {
    document.body.classList.toggle("has-player", hasSong);
    document.body.classList.toggle("has-capsule", capsule);
    return () => document.body.classList.remove("has-player", "has-capsule");
  }, [hasSong, capsule]);

  if (wide) {
    return (
      <>
        {deck && song && <Deck song={song} onClose={() => setSettings({ nowPanel: false })} />}
        {capsule && <Capsule expanded={roomy} onOpen={roomy ? () => setSettings({ nowPanel: true }) : () => setOpen(true)} />}
        {!roomy && <NowPlaying open={open} onClose={() => setOpen(false)} />}
      </>
    );
  }
  if (!song) return null;
  const button = "tap size-10 grid place-items-center rounded-full flex-none text-text active:bg-surface-2";
  return (
    <>
      <div data-open-player="" className={cx("fixed z-25 inset-x-3 bottom-[calc(var(--tabs-h)+var(--safe-bottom)+6px)] max-w-140 mx-auto h-(--mini-h) flex items-center gap-3 py-2 pr-2 pl-2 overflow-hidden cursor-pointer rounded-[24px] bg-glass-strong backdrop-blur-2xl backdrop-saturate-150 animate-slide-up", isRemote ? "shadow-[0_12px_32px_rgb(0_0_0/.35),inset_0_0_0_1.5px_var(--accent)]" : "shadow-[0_12px_32px_rgb(0_0_0/.35),inset_0_0_0_1px_var(--line)]")} onClick={() => setOpen(true)}>
        <SongCover song={song} size={96} className="size-12 rounded-2xl object-cover bg-surface-2 flex-none" />
        <div className={cx(lines, "flex-1")}>
          <b>{song.title}</b>
          {isRemote ? <span className={onDevice}>{`Playing on ${deviceName}`}</span> : <span>{song.artist}</span>}
        </div>
        <button className={cx(button, isRemote && "text-accent")} aria-label="Choose a device" onClick={(e) => { e.stopPropagation(); openDevicePicker(); }}><Icon name="devices" /></button>
        <button className="tap size-11 grid place-items-center rounded-full flex-none bg-text text-bg active:scale-[.94]" aria-label={playing ? "Pause" : "Play"} onClick={(e) => { e.stopPropagation(); player.toggle(); }}>{loading ? <Ring percent={-1} size={24} /> : <Icon name={playing ? "pause" : "play"} size={20} />}</button>
        <button className={button} aria-label="Next" onClick={(e) => { e.stopPropagation(); player.next(); }}><Icon name="next" /></button>
        <Hairline />
      </div>
      <NowPlaying open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The room takes the colour of the music: a slow wash of the cover's colour behind everything. It reads
 * the small cover the player has already fetched, and with "Colour the player" off only the accent colour shows. The same
 * colour feeds the accent when it is set to follow the album.
 */
export function Ambient() {
  const { song } = useShown();
  const tintOn = useSettings((s) => s.tint);
  const dynamic = useSettings((s) => s.dynamicAccent);
  const art = song && hasCover(song) ? songCover(song, 96) : "";
  const tint = useTint(art, (tintOn || dynamic) && Boolean(song));
  const known = art && tint !== NEUTRAL ? tint : null;
  useEffect(() => {
    document.documentElement.style.setProperty("--tint", tintOn && known ? known : "var(--glow)");
    setCoverColor(known);
  }, [known, tintOn]);
  useEffect(() => () => setCoverColor(null), []); // signed out: nothing is playing
  const wash = "absolute transition-colors duration-[1400ms] rounded-full";
  return (
    <div aria-hidden="true" className="fixed inset-0 overflow-hidden pointer-events-none">
      <i className={cx(wash, "-left-[15%] -top-[35%] size-[90vmax] opacity-(--ambient) bg-[rgb(var(--tint))] mask-[radial-gradient(closest-side,black,transparent)]")} />
      <i className={cx(wash, "-right-[20%] -bottom-[45%] size-[70vmax] opacity-[calc(var(--ambient)*.35)] bg-[rgb(var(--glow))] mask-[radial-gradient(closest-side,black,transparent)]")} />
    </div>
  );
}
