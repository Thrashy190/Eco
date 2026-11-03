// On a phone, the mini player above the tab bar and the full-screen player that opens from it. On a bigger screen, a bar
// along the bottom and a panel beside the page. All of them show this device or, when another is being controlled, that
// one; the controls go wherever the music is (see stores/connect.ts).
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { hasCover, songCover } from "../lib/api";
import { clock } from "../lib/format";
import { dominantColor } from "../lib/image";
import { useRoomy, useWide } from "../lib/media";
import type { Song } from "../lib/types";
import { useShown } from "../stores/connect";
import { toggleFavorite, useStarred } from "../stores/favorites";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { removeOffline, saveOffline } from "../stores/saving";
import { setSettings, useSettings } from "../stores/settings";
import { ArtistLinks } from "./ArtistLinks";
import { SongCover } from "./Cover";
import { DeviceButton, openDevicePicker } from "./Devices";
import { Icon, Ring } from "./Icon";
import { songMenu } from "./songs";

const NEUTRAL = "60 60 70";

/** Drag to change the volume. Hidden for iPhones, where only the hardware buttons can. */
function VolumeSlider({ volume, className = "volume" }: { volume: number; className?: string }) {
  return (
    <label className={className}>
      <Icon name={volume === 0 ? "volume-off" : "volume"} size={20} />
      <input type="range" min="0" max="100" value={Math.round(volume * 100)} aria-label="Volume" onChange={(e) => player.setVolume(Number(e.target.value) / 100)} />
    </label>
  );
}

function Hairline() {
  const ratio = player.useTime((t) => (t.length ? Math.min(t.position / t.length, 1) : 0));
  return <i className="hairline" style={{ transform: `scaleX(${ratio})` }} />;
}

function SeekBar() {
  const position = player.useTime((t) => t.position);
  const length = player.useTime((t) => t.length);
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? (length ? (position / length) * 1000 : 0);
  const finish = () => { if (dragging !== null) { player.seek((dragging / 1000) * length); setDragging(null); } };
  return (
    <div className="seek">
      <input type="range" min="0" max="1000" value={Math.round(shown)} aria-label="Position"
        onChange={(e) => setDragging(Number(e.target.value))} onPointerUp={finish} onKeyUp={finish} />
      <div className="times"><span>{clock(dragging !== null ? (dragging / 1000) * length : position)}</span><span>{clock(length)}</span></div>
    </div>
  );
}

function Queue({ upcoming, index }: { upcoming: Song[]; index: number }) {
  return (
    <ul className="rows queue">
      {upcoming.length === 0 && <li className="empty">The queue is empty</li>}
      {upcoming.map((next, k) => (
        <li className="row" key={`${next.id}-${k}`} onClick={() => player.jumpTo(index + 1 + k)}>
          <div className="text"><b>{next.title}</b><span>{next.artist}</span></div>
          <span className="time">{next.duration ? clock(next.duration) : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function NowPlaying({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const shown = useShown();
  const { song, playing, loading, shuffle, repeat, speed, upcoming, index } = shown;
  const starred = useStarred(song);
  const tintOn = useSettings((s) => s.tint);
  offline.useOfflineVersion();

  const art = song && hasCover(song) ? songCover(song, 600) : "";
  const [tint, setTint] = useState(NEUTRAL);
  useEffect(() => {
    if (!open) return; // a closed player must not spend the connection on a big picture every song
    if (!art) { setTint(NEUTRAL); return; }
    const probe = new Image();
    probe.onload = () => setTint(dominantColor(probe) ?? NEUTRAL);
    probe.src = art;
    return () => { probe.onload = null; };
  }, [art, open]);

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
  return (
    <section className={`now${raised ? " open" : ""}`} role="dialog" aria-label="Now playing" style={{ "--tint": tintOn ? tint : NEUTRAL } as React.CSSProperties}>
      <button className="close" aria-label="Minimise" onClick={onClose}><Icon name="down" size={28} /></button>
      <div className="now-main">
      {art ? <img key={art} className="art" src={art} alt="" /> : <div className="art empty" />}
      <div className="titles">
        <h2>{song.title}</h2>
        <ArtistLinks className="artist-link" name={song.artist} id={song.artistId} />
      </div>
      <SeekBar />
      <div className="transport">
        <button className={`ghost${shuffle ? " on" : ""}`} aria-label="Shuffle" aria-pressed={shuffle} onClick={player.toggleShuffle}><Icon name="shuffle" /></button>
        <button className="ghost" aria-label="Previous" onClick={player.previous}><Icon name="prev" size={30} /></button>
        <button className="main-play" aria-label={playing ? "Pause" : "Play"} onClick={player.toggle}>{loading ? <Ring percent={-1} size={24} /> : <Icon name={playing ? "pause" : "play"} size={24} />}</button>
        <button className="ghost" aria-label="Next" onClick={() => player.next()}><Icon name="next" size={30} /></button>
        <button className={`ghost${repeat !== "off" ? " on" : ""}`} data-mode={repeat} aria-label="Repeat" onClick={player.cycleRepeat}><Icon name="repeat" /></button>
      </div>
      {shown.canVolume && <VolumeSlider volume={shown.volume} />}
      <DeviceButton name={shown.deviceName} />
      <div className="extras">
        {!spoken && <button className={`ghost heart${starred ? " on" : ""}`} aria-label="Favorite" aria-pressed={starred} onClick={() => void toggleFavorite(song)}><Icon name={starred ? "heart-fill" : "heart"} /></button>}
        {spoken && <button className="ghost wide" aria-label="Playback speed" onClick={player.cycleSpeed}>{`${speed}×`}</button>}
        <button className="ghost wide" onClick={() => void (saved ? removeOffline(song) : saveOffline(song))}><Icon name={saved ? "check" : "offline"} size={20} />{saved ? "Saved offline" : "Save offline"}</button>
        <button className="ghost wide" onClick={() => songMenu(song, navigate)}><Icon name="more" size={20} />More</button>
      </div>
      </div>
      <div className="now-queue">
        <h3>Up next</h3>
        <Queue upcoming={upcoming} index={index} />
      </div>
    </section>
  );
}

function Transport({ shown }: { shown: ReturnType<typeof useShown> }) {
  const { playing, loading, shuffle, repeat } = shown;
  return (
    <div className="bar-transport">
      <button className={`ghost small${shuffle ? " on" : ""}`} aria-label="Shuffle" aria-pressed={shuffle} onClick={player.toggleShuffle}><Icon name="shuffle" size={18} /></button>
      <button className="ghost small" aria-label="Previous" onClick={player.previous}><Icon name="prev" size={20} /></button>
      <button className="bar-play" aria-label={playing ? "Pause" : "Play"} onClick={player.toggle}>{loading ? <Ring percent={-1} size={20} /> : <Icon name={playing ? "pause" : "play"} size={18} />}</button>
      <button className="ghost small" aria-label="Next" onClick={() => player.next()}><Icon name="next" size={20} /></button>
      <button className={`ghost small${repeat !== "off" ? " on" : ""}`} data-mode={repeat} aria-label="Repeat" onClick={player.cycleRepeat}><Icon name="repeat" size={18} /></button>
    </div>
  );
}

/** On a computer or a tablet: the player is a bar along the bottom, with everything at hand. */
function PlayerBar({ onOpen, panelOpen }: { onOpen: () => void; panelOpen: boolean }) {
  const shown = useShown();
  const { song, isRemote, deviceName } = shown;
  const starred = useStarred(song);
  if (!song) return null;
  const spoken = player.isSpoken(song);
  return (
    <footer className={`bar${isRemote ? " remote" : ""}`} aria-label="Player">
      <div className="bar-left">
        <button type="button" className="bar-cover" aria-label="Now playing" onClick={onOpen}><SongCover song={song} size={96} /></button>
        <div className="text">
          <b title={song.title}>{song.title}</b>
          {isRemote ? <span className="on-device">{`Playing on ${deviceName}`}</span> : <ArtistLinks name={song.artist} id={song.artistId} />}
        </div>
        {!spoken && <button className={`ghost small heart-plain${starred ? " on" : ""}`} aria-label="Favorite" aria-pressed={starred} onClick={() => void toggleFavorite(song)}><Icon name={starred ? "heart-fill" : "heart"} size={20} /></button>}
      </div>
      <div className="bar-center">
        <Transport shown={shown} />
        <SeekBar />
      </div>
      <div className="bar-right">
        {spoken && <button className="ghost small" aria-label="Playback speed" onClick={player.cycleSpeed}>{`${shown.speed}×`}</button>}
        <button className={`ghost small${panelOpen ? " on" : ""}`} aria-label="Now playing panel" title="Now playing" aria-pressed={panelOpen} onClick={onOpen}><Icon name="panel" size={20} /></button>
        <button className={`ghost small${isRemote ? " on" : ""}`} aria-label="Choose a device" title="Choose a device" onClick={openDevicePicker}><Icon name="devices" size={20} /></button>
        {shown.canVolume && <VolumeSlider volume={shown.volume} />}
      </div>
    </footer>
  );
}

/** On a big screen: what is playing and what comes next, beside the page. */
function NowPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const shown = useShown();
  const { song, upcoming, index } = shown;
  offline.useOfflineVersion();
  if (!song) return null;
  const saved = offline.isSaved(song.id);
  return (
    <aside className="panel" aria-label="Now playing">
      <header className="panel-head">
        <b title={song.album}>{song.album || "Now playing"}</b>
        <button type="button" className="icon-button" aria-label="Close this panel" onClick={onClose}><Icon name="down" size={20} /></button>
      </header>
      <SongCover song={song} size={600} className="cover panel-art" />
      <div className="titles">
        <h2>{song.title}</h2>
        <ArtistLinks className="artist-link" name={song.artist} id={song.artistId} />
      </div>
      <div className="extras">
        <button className="ghost wide" onClick={() => void (saved ? removeOffline(song) : saveOffline(song))}><Icon name={saved ? "check" : "offline"} size={18} />{saved ? "Saved" : "Save offline"}</button>
        <button className="ghost wide" onClick={() => songMenu(song, navigate)}><Icon name="more" size={18} />More</button>
      </div>
      <DeviceButton name={shown.deviceName} />
      <h3>Up next</h3>
      <Queue upcoming={upcoming} index={index} />
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

  // Any navigation (Go to artist, Go to album, a link) means the player must get out of the way
  useEffect(() => setOpen(false), [location.key]);
  const hasSong = Boolean(song);
  useEffect(() => {
    document.body.classList.toggle("has-player", hasSong);
    return () => document.body.classList.remove("has-player");
  }, [hasSong]);

  if (!song) return null;
  if (wide) {
    const togglePanel = () => setSettings({ nowPanel: !panel });
    return (
      <>
        {roomy && panel && <NowPanel onClose={togglePanel} />}
        <PlayerBar onOpen={roomy ? togglePanel : () => setOpen(true)} panelOpen={roomy && panel} />
        {!roomy && <NowPlaying open={open} onClose={() => setOpen(false)} />}
      </>
    );
  }
  return (
    <>
      <div className={`mini${isRemote ? " remote" : ""}`} onClick={() => setOpen(true)}>
        <SongCover song={song} size={96} />
        <div className="text">
          <b>{song.title}</b>
          {isRemote ? <span className="on-device">{`Playing on ${deviceName}`}</span> : <span>{song.artist}</span>}
        </div>
        <button className={`icon-button${isRemote ? " remote" : ""}`} aria-label="Choose a device" onClick={(e) => { e.stopPropagation(); openDevicePicker(); }}><Icon name="devices" /></button>
        <button className="icon-button" aria-label={playing ? "Pause" : "Play"} onClick={(e) => { e.stopPropagation(); player.toggle(); }}>{loading ? <Ring percent={-1} size={24} /> : <Icon name={playing ? "pause" : "play"} size={24} />}</button>
        <button className="icon-button" aria-label="Next" onClick={(e) => { e.stopPropagation(); player.next(); }}><Icon name="next" /></button>
        <Hairline />
      </div>
      <NowPlaying open={open} onClose={() => setOpen(false)} />
    </>
  );
}
