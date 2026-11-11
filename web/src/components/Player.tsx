// On a phone, the mini player above the tab bar and the full-screen player that opens from it. On a tablet, a capsule
// floating over the page that opens the same full-screen player. On a computer, the deck: a column of its own with what
// is playing and what comes next. All of them show this device or, when another is being controlled, that
// one; the controls go wherever the music is (see stores/connect.ts).
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { hasCover, songCover, wallpaperUrl } from "../lib/api";
import { readableDim, shownDim, type Ink } from "../lib/color";
import { DECK_MAX, DECK_MIN, deckWidthFor, PAGE_ROOM } from "../lib/look";
import { clock } from "../lib/format";
import { dominantColor, pixelsOf } from "../lib/image";
import { useRoomy, useWide } from "../lib/media";
import type { Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { useShown } from "../stores/connect";
import { toggleFavorite, useStarred } from "../stores/favorites";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { removeOffline, saveOffline } from "../stores/saving";
import { DEFAULTS, setCoverColor, setSettings, useInk, useSettings } from "../stores/settings";
import { toast } from "../stores/ui";
import { ArtistLinks } from "./ArtistLinks";
import { SongCover } from "./Cover";
import { Queue } from "./Queue";
import { DeviceButton, openDevicePicker } from "./Devices";
import { Icon, Ring } from "./Icon";
import { Logo } from "./Logo";
import { songMenu } from "./songs";

const NEUTRAL = "60 60 70";

const ghost = "tap relative size-13 grid place-items-center rounded-full text-text opacity-85 data-on:opacity-100 data-on:text-accent data-on:after:content-[''] data-on:after:absolute data-on:after:bottom-1.5 data-on:after:size-1 data-on:after:rounded-full data-on:after:bg-accent data-[mode=one]:data-on:before:content-['1'] data-[mode=one]:data-on:before:absolute data-[mode=one]:data-on:before:top-3 data-[mode=one]:data-on:before:right-3.5 data-[mode=one]:data-on:before:text-[.62rem] data-[mode=one]:data-on:before:font-extrabold";
const ghostSmall = "tap relative size-9 grid place-items-center rounded-full text-muted hover:text-text data-on:text-accent data-on:after:content-[''] data-on:after:absolute data-on:after:bottom-0.5 data-on:after:size-1 data-on:after:rounded-full data-on:after:bg-accent data-[mode=one]:data-on:before:content-['1'] data-[mode=one]:data-on:before:absolute data-[mode=one]:data-on:before:top-1.25 data-[mode=one]:data-on:before:right-1.5 data-[mode=one]:data-on:before:text-[.62rem] data-[mode=one]:data-on:before:font-extrabold";
const ghostWide = "tap flex-1 h-11.5 inline-flex items-center justify-center gap-2 rounded-full bg-ghost text-text font-bold text-[.9rem] hover:brightness-125";
const heart = "tap flex-none size-11.5 grid place-items-center rounded-full bg-ghost text-text data-on:text-love data-on:[&_svg]:animate-pop";
const roundToggle = "tap flex-none size-11.5 grid place-items-center rounded-full bg-ghost text-text data-on:text-accent data-on:bg-[rgb(var(--glow)/.16)] data-on:[&_svg]:animate-pop";
const AUTOPLAY_HINT = "Autoplay: when the queue ends, keep going with random songs from your library";

/** Autoplay on or off, saying which: the button alone is only a sparkle. Off takes away the songs it lined up. */
function toggleAutoplay(on: boolean): void {
  player.toggleAutoplay();
  toast(on ? "Autoplay off" : "Autoplay on: random songs follow when the queue ends");
}
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

/** The size of the song's picture in the full-screen player. */
const ART = "w-[min(82vw,44vh,420px)] wide:w-[min(40vw,54vh,420px)]";

/**
 * A record: the cover is its label, and it turns at 33⅓ while the music plays. The light on it stays still, as on a
 * real one. Motion turned down stops it.
 */
function Vinyl({ src, playing, className }: { src: string; playing: boolean; className?: string }) {
  return (
    <div className={cx("relative aspect-square rounded-full", className)} aria-hidden="true">
      <div className={cx("record absolute inset-0 rounded-full shadow-[0_24px_60px_rgb(0_0_0/.5),0_4px_16px_rgb(0_0_0/.4)]", !playing && "[animation-play-state:paused]")}
        style={{ background: "repeating-radial-gradient(circle, #121214 0 1.5px, #1d1d21 1.5px 3px)" }}>
        {src
          ? <img src={src} alt="" draggable={false} className="absolute left-[31%] top-[31%] w-[38%] h-[38%] rounded-full object-cover" />
          : <i className="absolute left-[31%] top-[31%] w-[38%] h-[38%] rounded-full bg-accent" />}
        <i className="absolute left-1/2 top-1/2 size-[3.5%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg shadow-[inset_0_0_0_1px_rgb(255_255_255/.25)]" />
      </div>
      <i className="absolute inset-0 rounded-full pointer-events-none"
        style={{ background: "conic-gradient(from 210deg, transparent 0deg, rgb(255 255 255 / .16) 22deg, transparent 50deg, transparent 180deg, rgb(255 255 255 / .1) 202deg, transparent 230deg)" }} />
    </div>
  );
}

/**
 * The cover as the whole background. It lies under as much of the page's colour as keeps text readable on it; on a
 * phone the top, where no text is, shows it clearly.
 */
function Backdrop({ src, className }: { src: string; className?: string }) {
  const ink = useInk();
  const readable = useReadableDim(src, ink);
  const wide = useWide();
  const veil = `color-mix(in srgb, var(--bg) ${Math.round(readable * 100)}%, transparent)`;
  return (
    <div aria-hidden="true" className={cx("overflow-hidden pointer-events-none", className)}>
      <img key={src} src={src} alt="" className="absolute inset-0 size-full object-cover animate-fade-in" />
      <i className="absolute inset-0" style={{ background: wide ? veil : `linear-gradient(to bottom, transparent 10%, ${veil} 46%, ${veil} 70%, var(--bg) 96%)` }} />
    </div>
  );
}

function NowPlaying({ open, onClose, onFullScreen }: { open: boolean; onClose: () => void; onFullScreen?: () => void }) {
  const navigate = useNavigate();
  const shown = useShown();
  const { song, playing, loading, shuffle, repeat, speed, upcoming, index } = shown;
  const starred = useStarred(song);
  const tintOn = useSettings((s) => s.tint);
  const look = useSettings((s) => s.playerStyle);
  offline.useOfflineVersion();

  const art = song && hasCover(song) ? songCover(song, 600) : "";
  const tint = useTint(art, open);
  const backdrop = look === "backdrop" && art !== "";

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
  const slide = cx("transition-transform duration-240 ease-snap", raised ? "translate-y-0" : "translate-y-full");
  return (
    <>
    {/* Outside the panel, which scrolls: the picture stays put behind it */}
    {backdrop && <Backdrop src={art} className={cx("fixed inset-0 z-50 bg-bg", slide)} />}
    <section role="dialog" aria-label="Now playing" style={{ "--tint": tintOn ? tint : NEUTRAL } as React.CSSProperties}
      className={cx(
        "fixed inset-0 z-50 flex flex-col items-center gap-4.5 overflow-y-auto px-6 pt-[calc(var(--safe-top)+10px)] pb-[calc(var(--safe-bottom)+28px)]",
        "wide:grid wide:grid-cols-[minmax(0,440px)_minmax(0,400px)] wide:grid-rows-[auto_minmax(0,1fr)] wide:justify-center wide:items-start wide:gap-x-12 wide:gap-y-3 wide:overflow-hidden wide:pt-10",
        !backdrop && "[background:radial-gradient(130%_75%_at_50%_12%,rgb(var(--tint)/.8),transparent_72%),var(--bg)] wide:[background:radial-gradient(90%_80%_at_20%_30%,rgb(var(--tint)/.75),transparent_70%),var(--bg)]",
        slide,
      )}>
      <div className="self-stretch flex items-center justify-between wide:col-span-full">
        <button className="w-11 h-9 grid place-items-center -ml-2 text-text" aria-label="Minimise" onClick={onClose}><Icon name="down" size={28} /></button>
        {onFullScreen && <button className="hidden wide:grid w-11 h-9 place-items-center -mr-2 text-text" aria-label="Full screen" title="Full screen" onClick={onFullScreen}><Icon name="expand" size={22} /></button>}
      </div>
      <div className="contents wide:flex wide:flex-col wide:gap-4.5 wide:min-h-0 wide:max-h-full wide:overflow-y-auto wide:no-scrollbar">
        {look === "minimal"
          ? (
            <div className={cx(column, "min-h-[min(70vw,40vh,380px)] flex flex-col justify-end gap-2 wide:min-h-[min(40vw,54vh,420px)]")}>
              {song.album && <span className="text-[.78rem] uppercase tracking-[.14em] font-semibold text-muted truncate">{song.album}</span>}
              <h2 className="font-title text-[clamp(2.4rem,11vw,4.2rem)] font-bold leading-[.98] tracking-[-.04em] wrap-anywhere line-clamp-4">{song.title}</h2>
              <ArtistLinks className="text-[1.15rem] text-muted font-semibold justify-self-start" name={song.artist} id={song.artistId} />
            </div>
          )
          : backdrop || !art
            ? <div className={cx(ART, "invisible aspect-square mx-auto flex-none")} />
            : look === "vinyl"
              ? <Vinyl key={art} src={art} playing={playing} className={cx(ART, "mx-auto mt-1 flex-none animate-art-in")} />
              : <img key={art} src={art} alt="" className={cx(ART, "aspect-square rounded-big object-cover bg-surface-2 mx-auto mt-1 flex-none animate-art-in shadow-[0_24px_60px_rgb(var(--tint)/.55),0_4px_16px_rgb(0_0_0/.4)]")} />}
        {look !== "minimal" && (
          <div className={cx("grid gap-0.5", column)}>
            <h2 className="font-title text-[1.7rem] font-bold tracking-[-.03em] leading-[1.1] wrap-anywhere wide:text-[2rem]">{song.title}</h2>
            <ArtistLinks className="text-muted font-semibold justify-self-start" name={song.artist} id={song.artistId} />
          </div>
        )}
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
          {!spoken && <button className={roundToggle} data-on={shown.autoplay || undefined} aria-label="Autoplay" aria-pressed={shown.autoplay} title={AUTOPLAY_HINT} onClick={() => toggleAutoplay(shown.autoplay)}><Icon name="sparkle" /></button>}
          {spoken && <button className={ghostWide} aria-label="Playback speed" onClick={player.cycleSpeed}>{`${speed}×`}</button>}
          <button className={ghostWide} onClick={() => void (saved ? removeOffline(song) : saveOffline(song))}><Icon name={saved ? "check" : "offline"} size={20} />{saved ? "Saved offline" : "Save offline"}</button>
          <button className={ghostWide} onClick={() => songMenu(song, navigate)}><Icon name="more" size={20} />More</button>
        </div>
      </div>
      <div className="contents wide:block wide:min-h-0 wide:max-h-full wide:overflow-y-auto wide:no-scrollbar">
        <Queue upcoming={upcoming} index={index} source={shown.source} autoplay={shown.autoplay} heading="text-[.8rem] uppercase tracking-[.08em] text-muted mt-2 mb-1 [&:not(:first-child)]:mt-5" />
      </div>
    </section>
    </>
  );
}

/** Where the deck or the full-screen player is not open: the essentials in a capsule floating over the page. */
function Capsule({ onOpen, expanded, onFullScreen }: { onOpen: () => void; expanded: boolean; onFullScreen: () => void }) {
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
      <button className={ghostSmall} aria-label="Full screen" title="Full screen" onClick={onFullScreen}><Icon name="expand" size={19} /></button>
    </footer>
  );
}

/** The deck, while something is playing: the song itself and every control, with what comes next beneath. */
function DeckNow({ song }: { song: Song }) {
  const navigate = useNavigate();
  const shown = useShown();
  const { playing, loading, shuffle, repeat, upcoming, index, isRemote, deviceName } = shown;
  const starred = useStarred(song);
  const look = useSettings((s) => s.playerStyle);
  offline.useOfflineVersion();
  const spoken = player.isSpoken(song);
  const saved = offline.isSaved(song.id);
  const art = hasCover(song) ? songCover(song, 600) : "";
  const size = "block mx-auto w-full max-w-[min(100%,38dvh)]";
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {look === "backdrop" && art !== "" && <Backdrop src={art} className="absolute inset-0 -z-10" />}
      <div className="flex-none px-4 pb-2">
        {look === "cover" && <SongCover song={song} size={600} className={cx(size, "h-auto aspect-square rounded-[22px] object-cover bg-surface-2 shadow-[0_20px_50px_rgb(var(--tint)/.4),0_4px_14px_rgb(0_0_0/.3)] transition-shadow duration-700")} />}
        {look === "vinyl" && <Vinyl key={art} src={art} playing={playing} className={size} />}
        {look === "backdrop" && art !== "" && <div className="h-[min(18dvh,160px)]" />}
        <div className="flex items-start gap-2 mt-3.5">
          <div className="flex-1 min-w-0 grid gap-0.5">
            <h2 className={cx("font-title font-bold tracking-[-.025em] leading-[1.12]", look === "minimal" || look === "backdrop" ? "text-[2rem] leading-[1.02] tracking-[-.035em] line-clamp-3" : "text-[1.4rem] line-clamp-2")} title={song.title}>{song.title}</h2>
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
          {!spoken && <button className={ghostSmall} data-on={shown.autoplay || undefined} aria-label="Autoplay" aria-pressed={shown.autoplay} title={AUTOPLAY_HINT} onClick={() => toggleAutoplay(shown.autoplay)}><Icon name="sparkle" size={19} /></button>}
          {spoken && <button className={ghostSmall} aria-label="Playback speed" onClick={player.cycleSpeed}>{`${shown.speed}×`}</button>}
          {shown.canVolume && <VolumeSlider volume={shown.volume} className="flex-1 min-w-0 pl-1" />}
        </div>
      </div>
      <div className="flex-1 min-h-24 overflow-y-auto px-2 pb-3 border-t border-line [scrollbar-width:thin]">
        <Queue upcoming={upcoming} index={index} source={shown.source} autoplay={shown.autoplay} heading="px-2 pt-3 pb-1 text-[.8rem] font-semibold text-muted" />
      </div>
    </div>
  );
}

/**
 * The deck's edge toward the page: dragging it makes the deck wider or narrower, as with a sidebar. The arrow keys do the
 * same, and a double click goes back to the usual width. The width is saved when the drag ends, not on every pixel.
 */
function DeckEdge({ width, onDrag }: { width: number; onDrag: (width: number | null) => void }) {
  const wanted = (w: number) => deckWidthFor(w, window.innerWidth);
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const edge = e.currentTarget;
    const from = e.clientX;
    let last = width;
    edge.setPointerCapture(e.pointerId);
    document.documentElement.dataset.resizing = "";
    const move = (ev: PointerEvent) => { last = wanted(width + from - ev.clientX); onDrag(last); };
    const end = () => {
      edge.removeEventListener("pointermove", move);
      edge.removeEventListener("pointerup", end);
      edge.removeEventListener("pointercancel", end);
      delete document.documentElement.dataset.resizing;
      setSettings({ deckWidth: last });
      onDrag(null);
    };
    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", end);
    edge.addEventListener("pointercancel", end);
  };
  const step = (by: number) => setSettings({ deckWidth: wanted(width + by) });
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize the deck" aria-valuemin={DECK_MIN} aria-valuemax={DECK_MAX} aria-valuenow={width} tabIndex={0}
      className="group/edge absolute -left-3 inset-y-0 z-20 w-3 cursor-col-resize touch-none outline-none"
      onPointerDown={start} onDoubleClick={() => setSettings({ deckWidth: DEFAULTS.deckWidth })}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); step(24); } else if (e.key === "ArrowRight") { e.preventDefault(); step(-24); } }}>
      <i className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text opacity-0 transition-[opacity,height] duration-150 group-hover/edge:opacity-40 group-focus-visible/edge:opacity-70 in-data-resizing:h-20 in-data-resizing:opacity-70" />
    </div>
  );
}

/**
 * The stage: the player over the whole screen, as on the TV (roku/components/screens/NowPlayingScreen.xml). The big cover,
 * the song in large type, the controls and what comes next, over the cover's colour. It fills the browser's tab, not the
 * whole screen (the maintainer's choice), and Esc closes it. After a few seconds without the mouse moving, the controls
 * and the pointer fade away, and only the cover and the song stay.
 */
function Stage({ onClose }: { onClose: () => void }) {
  const shown = useShown();
  const { song, playing, loading, shuffle, repeat, upcoming, index, isRemote, deviceName } = shown;
  const starred = useStarred(song);
  const tintOn = useSettings((s) => s.tint);
  const look = useSettings((s) => s.playerStyle);
  const art = song && hasCover(song) ? songCover(song, 1000) : "";
  const tint = useTint(art, true);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Still for a while: only the music stays on screen. Any movement or key brings the controls back
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => { setIdle(false); clearTimeout(timer); timer = setTimeout(() => setIdle(true), 3500); };
    wake();
    const events = ["pointermove", "pointerdown", "keydown"] as const;
    events.forEach((name) => window.addEventListener(name, wake));
    return () => { clearTimeout(timer); events.forEach((name) => window.removeEventListener(name, wake)); };
  }, []);

  useEffect(() => { if (!song) onClose(); }, [song, onClose]);
  if (!song) return null;
  const spoken = player.isSpoken(song);
  const next = upcoming.slice(0, 8);
  const fade = cx("transition-opacity duration-500", idle && "opacity-0 pointer-events-none");
  const bigGhost = "tap relative size-14 grid place-items-center rounded-full text-text opacity-85 hover:opacity-100 data-on:opacity-100 data-on:text-accent data-on:after:content-[''] data-on:after:absolute data-on:after:bottom-1.5 data-on:after:size-1 data-on:after:rounded-full data-on:after:bg-accent data-[mode=one]:data-on:before:content-['1'] data-[mode=one]:data-on:before:absolute data-[mode=one]:data-on:before:top-3 data-[mode=one]:data-on:before:right-3.5 data-[mode=one]:data-on:before:text-[.62rem] data-[mode=one]:data-on:before:font-extrabold";
  return (
    <section role="dialog" aria-label="Full-screen player" style={{ "--tint": tintOn ? tint : NEUTRAL } as React.CSSProperties}
      className={cx("fixed inset-0 z-60 overflow-hidden flex flex-col px-[6vw] pt-[calc(var(--safe-top)+4vh)] pb-[calc(var(--safe-bottom)+4vh)] animate-fade-in",
        "[background:radial-gradient(80%_90%_at_22%_40%,rgb(var(--tint)/.7),transparent_72%),radial-gradient(60%_60%_at_90%_100%,rgb(var(--tint)/.25),transparent_70%),var(--bg)]",
        idle && "cursor-none")}>
      <header className={cx("flex-none flex items-center gap-3", fade)}>
        <Logo size={34} className="rounded-[9px]" />
        <b className="flex-1 min-w-0 truncate font-title font-bold text-muted text-[1.05rem]">{isRemote ? `Playing on ${deviceName}` : shown.source || "Now playing"}</b>
        <button type="button" className={ui.iconButton} aria-label="Close the full-screen player" title="Close (Esc)" onClick={onClose}><Icon name="shrink" size={22} /></button>
      </header>
      <div className="flex-1 min-h-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-[5vw] py-[3vh]">
        {look === "vinyl"
          ? <Vinyl key={art} src={art} playing={playing} className="h-[min(58vh,40vw)] max-h-full" />
          : art
            ? <img key={art} src={art} alt="" className="h-[min(58vh,40vw)] max-h-full aspect-square rounded-[min(3vw,32px)] object-cover bg-surface-2 animate-art-in shadow-[0_40px_100px_rgb(var(--tint)/.5),0_8px_30px_rgb(0_0_0/.45)]" />
            : <div className="h-[min(58vh,40vw)] aspect-square rounded-[min(3vw,32px)] bg-surface-2 grid place-items-center text-muted"><Icon name="play" size={64} /></div>}
        <div className="min-w-0 grid gap-[1.2vh]">
          {song.album && <span className="text-[clamp(.9rem,1.3vw,1.3rem)] uppercase tracking-[.14em] font-semibold text-muted truncate">{song.album}</span>}
          <h2 className="font-title font-bold text-[clamp(2.4rem,5.6vw,6.5rem)] leading-[.98] tracking-[-.04em] wrap-anywhere line-clamp-3" title={song.title}>{song.title}</h2>
          <ArtistLinks className="text-[clamp(1.1rem,2vw,2.1rem)] text-muted font-semibold justify-self-start" name={song.artist} id={song.artistId} />
          <div className={cx("min-w-0 grid gap-3 mt-[3vh] max-w-[760px]", fade)}>
            <SeekBar />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
              <button className={bigGhost} data-on={shuffle || undefined} aria-label="Shuffle" aria-pressed={shuffle} onClick={player.toggleShuffle}><Icon name="shuffle" size={24} /></button>
              <button className={bigGhost} aria-label="Previous" onClick={player.previous}><Icon name="prev" size={32} /></button>
              <button className="tap size-20 grid place-items-center rounded-full bg-accent text-accent-ink shadow-[0_14px_36px_rgb(var(--glow)/.35)] hover:scale-105 active:scale-[.96]" aria-label={playing ? "Pause" : "Play"} onClick={player.toggle}>{loading ? <Ring percent={-1} size={28} /> : <Icon name={playing ? "pause" : "play"} size={28} />}</button>
              <button className={bigGhost} aria-label="Next" onClick={() => player.next()}><Icon name="next" size={32} /></button>
              <button className={bigGhost} data-on={repeat !== "off" || undefined} data-mode={repeat} aria-label="Repeat" onClick={player.cycleRepeat}><Icon name="repeat" size={24} /></button>
              <span className="flex-1 min-w-4" />
              <span className="flex items-center gap-2">
                {!spoken && <button className={heartPlain} data-on={starred || undefined} aria-label="Favorite" aria-pressed={starred} onClick={() => void toggleFavorite(song)}><Icon name={starred ? "heart-fill" : "heart"} size={24} /></button>}
                <button className={ghostSmall} data-on={isRemote || undefined} aria-label="Choose a device" title="Choose a device" onClick={openDevicePicker}><Icon name="devices" size={22} /></button>
                {shown.canVolume && <VolumeSlider volume={shown.volume} className="w-36 flex-none" />}
              </span>
            </div>
          </div>
        </div>
      </div>
      {next.length > 0 && (
        <footer className={cx("flex-none grid gap-2.5", fade)}>
          <b className="font-title font-bold text-[1.05rem]">Up next</b>
          <ol className="flex gap-4 overflow-hidden">
            {next.map((s, i) => (
              <li key={`${s.id}-${i}`} className="flex-none w-[clamp(96px,9vw,150px)]">
                <button type="button" className="tap group/next grid gap-1.5 w-full text-left" aria-label={`Play ${s.title}`} onClick={() => player.jumpTo(index + 1 + i)}>
                  <SongCover song={s} size={300} className="w-full aspect-square rounded-2xl object-cover bg-surface-2 transition-transform group-hover/next:scale-[1.03]" />
                  <span className="truncate text-[.85rem] font-[650]">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </footer>
      )}
    </section>
  );
}

/** A column of its own beside the page, on a screen with room, while something is playing. */
function Deck({ song, onClose, onFullScreen }: { song: Song; onClose: () => void; onFullScreen: () => void }) {
  const saved = useSettings((s) => s.deckWidth);
  const [dragging, setDragging] = useState<number | null>(null);
  const width = dragging ?? saved;
  return (
    <div className="relative z-10 flex min-h-0" style={{ width: `clamp(${DECK_MIN}px, min(${width}px, 100vw - ${PAGE_ROOM}px), ${DECK_MAX}px)` }}>
      <DeckEdge width={width} onDrag={setDragging} />
      <aside aria-label="Now playing" className={cx("flex-1 min-w-0 flex flex-col min-h-0 rounded-[28px] overflow-hidden", glass)}>
        <header className="flex-none flex items-center gap-1.5 pl-5 pr-2 pt-2 pb-1">
          <b className="flex-1 min-w-0 truncate font-semibold text-[.88rem] text-muted" title={song.album}>{song.album || "Now playing"}</b>
          <button type="button" className={ui.iconButton} aria-label="Full screen" title="Full screen" onClick={onFullScreen}><Icon name="expand" size={18} /></button>
          <button type="button" className={ui.iconButton} aria-label="Hide the deck" onClick={onClose}><span className="inline-flex -rotate-90"><Icon name="down" size={20} /></span></button>
        </header>
        <DeckNow song={song} />
      </aside>
    </div>
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
  const [stage, setStage] = useState(false);
  const closeStage = useCallback(() => setStage(false), []);
  const openStage = () => {
    setOpen(false);
    setStage(true);
  };
  const deck = wide && roomy && panel && Boolean(song);
  const capsule = wide && !deck && Boolean(song);

  // Any navigation (Go to artist, Go to album, a link) means the player must get out of the way
  useEffect(() => { setOpen(false); setStage(false); }, [location.key]);
  const hasSong = Boolean(song);
  useEffect(() => {
    document.body.classList.toggle("has-player", hasSong);
    document.body.classList.toggle("has-capsule", capsule);
    return () => document.body.classList.remove("has-player", "has-capsule");
  }, [hasSong, capsule]);

  if (wide) {
    return (
      <>
        {deck && song && <Deck song={song} onClose={() => setSettings({ nowPanel: false })} onFullScreen={openStage} />}
        {capsule && <Capsule expanded={roomy} onOpen={roomy ? () => setSettings({ nowPanel: true }) : () => setOpen(true)} onFullScreen={openStage} />}
        {!roomy && <NowPlaying open={open} onClose={() => setOpen(false)} onFullScreen={openStage} />}
        {stage && <Stage onClose={closeStage} />}
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
/**
 * How much of the page's colour must lie over a picture for text on it to read (lib/color.ts readableDim). Until the
 * picture has been measured, assume it needs a fair amount rather than flash unreadable text.
 */
function useReadableDim(src: string, ink: Ink): number {
  const [dim, setDim] = useState(0.6);
  useEffect(() => {
    if (!src) return;
    const probe = new Image();
    probe.onload = () => setDim(readableDim(pixelsOf(probe), ink));
    probe.src = src;
    return () => { probe.onload = null; };
  }, [src, ink]);
  return dim;
}

/**
 * Behind everything: the colour of the music, a picture of your own or the cover playing (Settings › Background). A
 * picture lies under as much of the page's colour as keeps text readable on it, plus however much more you chose.
 */
export function Ambient() {
  const { song } = useShown();
  const tintOn = useSettings((s) => s.tint);
  const dynamic = useSettings((s) => s.dynamicAccent);
  const background = useSettings((s) => s.background);
  const wallpaper = useSettings((s) => s.wallpaper);
  const blur = useSettings((s) => s.backgroundBlur);
  const extra = useSettings((s) => s.backgroundDim);
  const washOver = useSettings((s) => s.backgroundWash);
  const ink = useInk();
  const art = song && hasCover(song) ? songCover(song, 96) : "";
  const tint = useTint(art, (tintOn || dynamic) && Boolean(song));
  const known = art && tint !== NEUTRAL ? tint : null;
  useEffect(() => {
    document.documentElement.style.setProperty("--tint", tintOn && known ? known : "var(--glow)");
    setCoverColor(known);
  }, [known, tintOn]);
  useEffect(() => () => setCoverColor(null), []); // signed out: nothing is playing

  // A sharp cover needs its full size; a blurred one would look the same from a small one
  const picture = background === "photo" && wallpaper ? wallpaperUrl(wallpaper)
    : background === "cover" && song && hasCover(song) ? songCover(song, blur < 6 ? 600 : 300) : "";
  const readable = useReadableDim(picture, ink);
  const wash = "absolute transition-colors duration-[1400ms] rounded-full";
  return (
    <div aria-hidden="true" className="fixed inset-0 overflow-hidden pointer-events-none">
      {picture !== "" && (
        <>
          <img key={picture} src={picture} alt="" className="absolute inset-0 size-full object-cover animate-fade-in"
            style={blur > 0 ? { filter: `blur(${blur}px)`, transform: "scale(1.1)" } : undefined} />
          <i className="absolute inset-0 bg-bg transition-opacity duration-500" style={{ opacity: shownDim(readable, extra) }} />
        </>
      )}
      {(picture === "" || washOver) && (
        <>
          <i className={cx(wash, "-left-[15%] -top-[35%] size-[90vmax] opacity-(--ambient) bg-[rgb(var(--tint))] mask-[radial-gradient(closest-side,black,transparent)]")} />
          <i className={cx(wash, "-right-[20%] -bottom-[45%] size-[70vmax] opacity-[calc(var(--ambient)*.35)] bg-[rgb(var(--glow))] mask-[radial-gradient(closest-side,black,transparent)]")} />
        </>
      )}
    </div>
  );
}
