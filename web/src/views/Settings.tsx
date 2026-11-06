import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { approveTV, getSongs, signOut, username, wallpaperUrl, whoAmI } from "../lib/api";
import { plural, releaseUrl } from "../lib/format";
import { pictureToCover, pictureToWallpaper } from "../lib/image";
import { HOME_SECTIONS, homeOrder, MAX_TABS, moved, PLACES, REQUIRED_PLACE, tabsFrom } from "../lib/nav";
import { cx, ui } from "../lib/ui";
import { Credit } from "../components/common";
import { UserAvatar } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { openDevicePicker } from "../components/Devices";
import { ME_KEY } from "../stores/admin";
import { removeAvatar, setAvatar, useLibraryState } from "../stores/library";
import { myDeviceName, renameDevice, useConnect } from "../stores/connect";
import * as offline from "../stores/offline";
import { removeWallpaper, setWallpaper } from "../stores/look";
import { ACCENTS, resetSettings, setSettings, useOnline, useSettings, type Settings as SettingValues } from "../stores/settings";
import { openSheet, toast } from "../stores/ui";

/** A pill-shaped choice between a few options. */
function Segmented<K extends "theme" | "corners" | "density" | "motion" | "font" | "textSize" | "libraryView" | "glass" | "cardSize" | "favoritesColor">({ name, options }: { name: K; options: [SettingValues[K], string][] }) {
  const value = useSettings((s) => s[name]);
  return (
    <div className={SEG} role="group">
      {options.map(([option, label]) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => setSettings({ [name]: option } as Partial<SettingValues>)}>{label}</button>
      ))}
    </div>
  );
}

const SEG = "flex p-0.75 gap-0.5 rounded-full bg-ghost [&>button]:flex-1 [&>button]:px-3 [&>button]:py-1.75 [&>button]:rounded-full [&>button]:font-[650] [&>button]:text-[.85rem] [&>button]:text-muted [&>button]:whitespace-nowrap [&>button[aria-pressed=true]]:bg-accent [&>button[aria-pressed=true]]:text-accent-ink [&>button[aria-pressed=true]]:shadow-[0_2px_10px_rgb(var(--glow)/.35)]";
const SWATCH = "relative size-9.5 rounded-full bg-(--c) shadow-[inset_0_0_0_2px_rgb(255_255_255/.18)] transition-transform duration-200 ease-spring active:scale-[.88] aria-pressed:scale-[1.12] aria-pressed:shadow-[0_0_0_3px_var(--bg),0_0_0_5px_var(--c)]";
const REORDER_BUTTON = "tap size-9 grid place-items-center rounded-full text-muted flex-none disabled:opacity-25! hover:text-text";

/** Your picture. Tapping it changes it. It stays on this server, and only an administrator can see someone else's. */
function ProfilePicture() {
  const { avatar } = useLibraryState();
  const input = useRef<HTMLInputElement>(null);
  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      await setAvatar(await pictureToCover(file));
      toast("Picture updated");
    } catch (e) { toast((e as Error).message); }
  }
  const pick = () => input.current?.click();
  return (
    <div className="relative flex-none">
      <button type="button" aria-label="Change your picture" className="group/edit relative block size-16 rounded-full"
        onClick={() => {
          if (!avatar) { pick(); return; }
          openSheet("Your picture", undefined, [
            { icon: "image", label: "Choose another picture", run: pick },
            { icon: "trash", label: "Remove this picture", danger: true, run: () => void removeAvatar().then(() => toast("Picture removed")).catch((e: Error) => toast(e.message)) },
          ]);
        }}>
        <span className="size-full grid place-items-center rounded-full overflow-hidden font-extrabold text-[1.4rem] text-accent-ink bg-[linear-gradient(135deg,var(--accent),rgb(var(--glow)/.5))]"><UserAvatar /></span>
        <span className="absolute -right-0.5 -bottom-0.5 size-6.5 grid place-items-center rounded-full bg-text text-bg"><Icon name="pencil" size={13} /></span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

function Toggle({ name }: { name: "tint" | "scrobble" | "offlineMode" | "dynamicAccent" | "backgroundWash" | "syncLook" }) {
  const on = useSettings((s) => s[name]);
  return <button type="button" className={ui.toggle} role="switch" aria-checked={on} onClick={() => setSettings({ [name]: !on })} />;
}

function Setting({ title, description, stack, children }: { title: string; description?: string; stack?: boolean; children: ReactNode }) {
  return (
    <div className={stack ? ui.settingStack : ui.setting}>
      <div className={ui.settingLabel}><b>{title}</b>{description && <span>{description}</span>}</div>
      {children}
    </div>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section><div className={ui.groupTitle}>{title}</div><div className={ui.group}>{children}</div></section>
);

function Swatches() {
  const accent = useSettings((s) => s.accent).toLowerCase();
  const isPreset = ACCENTS.some(([, color]) => color === accent);
  const dynamic = useSettings((s) => s.dynamicAccent);
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {ACCENTS.map(([name, color]) => (
        <button key={color} type="button" className={SWATCH} style={{ "--c": color } as React.CSSProperties} aria-label={name} title={name} aria-pressed={!dynamic && color === accent} onClick={() => setSettings({ accent: color, dynamicAccent: false })} />
      ))}
      <span className={cx(SWATCH, "bg-[conic-gradient(#ff6b6b,#ffb84d,#b5e853,#7cf0c0,#6aa8ff,#b18cff,#ff7eb6,#ff6b6b)] overflow-hidden")} style={{ "--c": "transparent" } as React.CSSProperties} title="Pick any colour" aria-pressed={!dynamic && !isPreset}>
        <input type="color" className="absolute -inset-2 size-15 opacity-0 cursor-pointer" aria-label="Custom colour" value={accent} onChange={(e) => setSettings({ accent: e.target.value, dynamicAccent: false })} />
      </span>
    </div>
  );
}

// ---- Background and player: choices you see before you make them ----

const TILE = "tap group/tile grid gap-1.5 text-center text-[.8rem] font-semibold text-muted aria-pressed:text-text";
const TILE_ART = "relative aspect-[3/4] rounded-xl overflow-hidden bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)] group-aria-pressed/tile:shadow-[0_0_0_2px_var(--accent)] transition-shadow";

/** A row of options, each with a small drawing of what it looks like. */
function Choices<K extends "background" | "playerStyle">({ name, options, onPick }: {
  name: K;
  options: [SettingValues[K], string, ReactNode][];
  onPick?: (value: SettingValues[K]) => boolean; // false: the choice needs something first (a picture)
}) {
  const value = useSettings((s) => s[name]);
  return (
    <div className="grid grid-cols-4 gap-2.5" role="group">
      {options.map(([option, label, art]) => (
        <button key={option} type="button" className={TILE} aria-pressed={value === option}
          onClick={() => { if (onPick?.(option) !== false) setSettings({ [name]: option } as Partial<SettingValues>); }}>
          <span className={TILE_ART} aria-hidden="true">{art}</span>{label}
        </button>
      ))}
    </div>
  );
}

/** A slider for a number setting, with its value beside it. */
function Slider({ name, max, label, show }: { name: "backgroundBlur" | "backgroundDim"; max: number; label: string; show: (value: number) => string }) {
  const value = useSettings((s) => s[name]);
  const step = max / 40;
  return (
    <label className="flex items-center gap-3">
      <input type="range" className="range flex-1 min-w-0" style={{ "--fill": value / max } as React.CSSProperties} min="0" max={max} step={step} value={value}
        aria-label={label} onChange={(e) => setSettings({ [name]: Number(e.target.value) })} />
      <span className="w-11 flex-none text-right text-muted text-[.85rem] tabular-nums">{show(value)}</span>
    </label>
  );
}

const lines = (className = "") => (
  <span className={cx("absolute inset-x-2 bottom-2 grid gap-1", className)}>
    <i className="h-1.5 w-4/5 rounded-full bg-text/80" /><i className="h-1 w-1/2 rounded-full bg-text/40" />
  </span>
);

function BackgroundSettings() {
  const background = useSettings((s) => s.background);
  const wallpaper = useSettings((s) => s.wallpaper);
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await setWallpaper(await pictureToWallpaper(file));
      toast("Background updated");
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  }
  const pick = () => { if (online) input.current?.click(); else toast("Choosing a picture needs a connection"); };
  const picture = background !== "wash";
  return (
    <Group title="Background">
      <Setting title="Behind everything" description="Text stays readable on any picture: Eco darkens it as much as it needs" stack>
        <Choices name="background" onPick={(value) => { if (value === "photo" && !wallpaper) { pick(); return false; } return true; }} options={[
          ["wash", "Music colour", <span className="absolute inset-0 [background:radial-gradient(90%_70%_at_20%_15%,rgb(var(--tint)/.8),transparent_70%),radial-gradient(70%_60%_at_90%_100%,rgb(var(--glow)/.4),transparent_70%)]" />],
          ["photo", "Your picture", wallpaper
            ? <img src={wallpaperUrl(wallpaper)} alt="" className="absolute inset-0 size-full object-cover" />
            : <span className="absolute inset-0 grid place-items-center text-muted"><Icon name="image" size={26} /></span>],
          ["cover", "Album cover", <span className="absolute inset-0 grid place-items-center text-muted [background:linear-gradient(160deg,rgb(var(--tint)/.55),transparent)]"><Icon name="play" size={22} /></span>],
        ]} />
      </Setting>
      {background === "photo" && (
        <Setting title="Your picture" description="Kept on the server, so your other devices can show it too">
          <div className="flex gap-2">
            <button type="button" className={ui.pill} disabled={busy} onClick={pick}>{busy ? <Ring percent={-1} size={16} /> : <Icon name="image" size={16} />}Change</button>
            {wallpaper > 0 && <button type="button" className={ui.pill} aria-label="Remove the picture" onClick={() => void removeWallpaper().then(() => toast("Picture removed")).catch((e: Error) => toast(e.message))}><Icon name="trash" size={16} /></button>}
          </div>
        </Setting>
      )}
      {picture && <Setting title="Blur" stack><Slider name="backgroundBlur" max={40} label="Blur" show={(v) => (v === 0 ? "Off" : `${Math.round(v)}`)} /></Setting>}
      {picture && <Setting title="Darken" description="More than readability needs, to calm a busy picture" stack><Slider name="backgroundDim" max={1} label="Darken" show={(v) => `${Math.round(v * 100)}%`} /></Setting>}
      {picture && <Setting title="Music colour on top" description="The colour of what plays, glowing over the picture"><Toggle name="backgroundWash" /></Setting>}
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
    </Group>
  );
}

function PlayerSettings() {
  return (
    <Group title="Player">
      <Setting title="Style" description="How the full-screen player and the deck show what plays" stack>
        <Choices name="playerStyle" options={[
          ["cover", "Cover", <><span className="absolute left-1/2 top-[14%] w-[62%] aspect-square -translate-x-1/2 rounded-md bg-[linear-gradient(135deg,var(--accent),rgb(var(--glow)/.35))] shadow-md" />{lines()}</>],
          ["vinyl", "Vinyl", <><span className="absolute left-1/2 top-[12%] w-[66%] aspect-square -translate-x-1/2 rounded-full bg-[#141416] shadow-md [background:repeating-radial-gradient(circle,#121214_0_1px,#24242a_1px_2.5px)]"><i className="absolute inset-[32%] rounded-full bg-accent" /></span>{lines()}</>],
          ["backdrop", "Backdrop", <><span className="absolute inset-0 bg-[linear-gradient(160deg,var(--accent),rgb(var(--glow)/.2)_70%)]" /><span className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_35%,var(--surface-2)_85%)]" />{lines()}</>],
          ["minimal", "Minimal", <span className="absolute inset-x-2 bottom-2 grid gap-1.5"><i className="h-2.5 w-full rounded-full bg-text/85" /><i className="h-2.5 w-3/4 rounded-full bg-text/85" /><i className="h-1 w-1/2 rounded-full bg-text/40" /></span>],
        ]} />
      </Setting>
    </Group>
  );
}

/** A tiny sample so you can see what a choice does without leaving the screen. */
const Preview = () => (
  <div className="flex items-center gap-3 px-4 py-3 bg-surface-2" aria-hidden="true">
    <div className={cx(ui.cover, "grid place-items-center text-muted bg-[linear-gradient(135deg,var(--accent),rgb(var(--glow)/.35))]")}><Icon name="play" size={20} /></div>
    <div className="flex-1 min-w-0 grid [&>span]:text-muted [&>span]:text-[.85rem]"><b>Sample song</b><span>Sample artist · Album</span></div>
    <Ring percent={65} size={28} />
    <span className={ui.get}><Icon name="download" size={16} />Get</span>
  </div>
);

/** A list you can reorder, with a switch to show or hide each thing in it. */
function Reorder({ items, onMove, isOn, onToggle, locked }: {
  items: [string, string][];
  onMove: (index: number, by: -1 | 1) => void;
  isOn: (id: string) => boolean;
  onToggle: (id: string) => void;
  locked?: string;
}) {
  return (
    <ul className="grid gap-0.5 -mx-1.5 mt-1 -mb-1">
      {items.map(([id, label], i) => (
        <li key={id} className="flex items-center gap-0.5 min-h-11 pl-1.5 rounded-[10px]">
          <span className={cx("flex-1 min-w-0 font-semibold", !isOn(id) && "text-muted")}>{label}</span>
          <button type="button" className={REORDER_BUTTON} aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => onMove(i, -1)}><Icon name="up" size={18} /></button>
          <button type="button" className={REORDER_BUTTON} aria-label={`Move ${label} down`} disabled={i === items.length - 1} onClick={() => onMove(i, 1)}><Icon name="down" size={18} /></button>
          {id !== locked
            ? <button type="button" className={cx(ui.toggle, "ml-2")} role="switch" aria-label={`Show ${label}`} aria-checked={isOn(id)} onClick={() => onToggle(id)} />
            : <span className="w-12.5 ml-2 flex-none" title="Always here, so you can come back to Settings" />}
        </li>
      ))}
    </ul>
  );
}

function HomeSettings() {
  const saved = useSettings((s) => s.homeOrder);
  const hidden = useSettings((s) => s.homeHidden);
  const order = homeOrder(saved);
  const items = order.map((id): [string, string] => [id, HOME_SECTIONS.find(([key]) => key === id)![1]]);
  return (
    <Setting title="Home" description="What it shows, and in what order. Sections with nothing in them stay away by themselves." stack>
      <Reorder items={items} isOn={(id) => !hidden.includes(id)} onMove={(i, by) => setSettings({ homeOrder: moved(order, i, by) })}
        onToggle={(id) => setSettings({ homeHidden: hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id] })} />
    </Setting>
  );
}

function TabSettings() {
  const saved = useSettings((s) => s.tabs);
  const shown = tabsFrom(saved).map((p) => p.id);
  // The chosen ones first, in their order, then the rest of what can be chosen
  const all = [...shown, ...PLACES.map((p) => p.id).filter((id) => !shown.includes(id))];
  const items = all.map((id): [string, string] => [id, PLACES.find((p) => p.id === id)!.label]);
  return (
    <Setting title="Tabs" description={`Up to ${MAX_TABS} on a phone. On a bigger screen they sit in the top bar.`} stack>
      <Reorder items={items} locked={REQUIRED_PLACE} isOn={(id) => shown.includes(id)}
        onMove={(i, by) => { const next = moved(all, i, by).filter((id) => shown.includes(id)); setSettings({ tabs: next }); }}
        onToggle={(id) => {
          if (shown.includes(id)) { setSettings({ tabs: shown.filter((s) => s !== id) }); return; }
          if (shown.length >= MAX_TABS) { toast(`${MAX_TABS} tabs at most: turn one off first`); return; }
          setSettings({ tabs: [...shown.filter((s) => s !== REQUIRED_PLACE), id, REQUIRED_PLACE] });
        }} />
    </Setting>
  );
}

/** A TV shows a code instead of asking for a password typed with its remote. */
function ConnectTV() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const clean = code.replace(/[\s-]/g, "");
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (clean.length < 6 || busy) return;
    setBusy(true);
    try {
      await approveTV(clean);
      setCode("");
      toast("TV connected. It shows your music in a moment");
    } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Setting title="Connect a TV" description="Open Eco on the TV and type the code it shows" stack>
      <form className="flex gap-2" onSubmit={(e) => void connect(e)}>
        <input className={cx(ui.input, "uppercase tracking-[.2em]")} value={code} maxLength={9} placeholder="ABC-DEF" aria-label="Code shown on the TV"
          autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" className={cx(ui.pill, "disabled:opacity-50")} disabled={clean.length < 6 || busy}>{busy ? "Connecting…" : "Connect"}</button>
      </form>
    </Setting>
  );
}

function DeviceSettings() {
  const devices = useConnect((s) => s.devices);
  const [name, setName] = useState(myDeviceName);
  return (
    <Group title="This device">
      <Setting title="Name" description="How your other devices see this one" stack>
        <input className={ui.input} value={name} maxLength={60} aria-label="Device name" onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (name.trim() !== myDeviceName()) renameDevice(name); }} />
      </Setting>
      <Setting title="Where music plays" description={`${plural(devices.length, "device")} signed in to your account right now`}>
        <button type="button" className={ui.pill} onClick={openDevicePicker}><Icon name="devices" size={16} />Choose</button>
      </Setting>
      <ConnectTV />
    </Group>
  );
}

export function Settings() {
  const user = username();
  const version = offline.useOfflineVersion();
  const [usage, setUsage] = useState("Calculating…");
  useEffect(() => {
    void offline.usage().then(({ used, quota }) => {
      setUsage(offline.count() ? `${plural(offline.count(), "song")} · ${offline.megabytes(used)}${quota ? ` of ${offline.megabytes(quota)}` : ""}` : "Nothing saved");
    });
  }, [version]);
  const library = useQuery({ queryKey: ["songs-total"], queryFn: () => getSongs(0, 1) });
  const { data: me } = useQuery({ queryKey: ME_KEY, queryFn: whoAmI, staleTime: 5 * 60_000 });
  const syncLook = useSettings((s) => s.syncLook);

  return (
    <>
      <header className={ui.heroCompact}><h1>Settings</h1></header>
      <div className="grid gap-5.5 px-4 pb-2 wide:px-8 @4xl:block @4xl:columns-2 @4xl:gap-6 @4xl:*:mb-6 @4xl:*:break-inside-avoid">
        <div className="flex items-center gap-4 p-4.5 rounded-[calc(var(--radius)+6px)] bg-[linear-gradient(135deg,rgb(var(--glow)/.22),var(--surface)_70%)] shadow-[inset_0_0_0_1px_var(--line)] [&_h2]:text-[1.3rem] [&_h2]:font-extrabold [&_h2]:tracking-[-.02em] [&_p]:text-muted [&_p]:text-[.88rem] [&_p]:mt-0.5">
          <ProfilePicture />
          <div><h2>{user}</h2><p>{syncLook ? "Your look and your picture follow you to every device." : "Your look is saved on this device. Your picture follows you to every device."}</p></div>
        </div>

        <Group title="Appearance">
          <Setting title="Same look everywhere" description="What you choose here shows on all your devices"><Toggle name="syncLook" /></Setting>
          <Setting title="Theme" description="Follows your phone unless you choose one" stack>
            <Segmented name="theme" options={[["system", "Auto"], ["dark", "Dark"], ["light", "Light"], ["black", "Black"]]} />
          </Setting>
          <Setting title="Dynamic colour" description="Buttons, highlights and the Eco logo take the colour of the album playing"><Toggle name="dynamicAccent" /></Setting>
          <Setting title="Accent colour" description="Buttons, highlights and the logo, when nothing is playing or dynamic colour is off" stack><Swatches /></Setting>
          <Setting title="Favorites colour" description="The picture of your Favorites: its own violet, or the accent, which follows the music with dynamic colour on">
            <Segmented name="favoritesColor" options={[["classic", "Violet"], ["accent", "Accent"]]} />
          </Setting>
          <Preview />
          <Setting title="Corners"><Segmented name="corners" options={[["soft", "Soft"], ["sharp", "Sharp"]]} /></Setting>
          <Setting title="Glass" description="How much of what is behind the floating bars shows through" stack>
            <Segmented name="glass" options={[["clear", "Clear"], ["frosted", "Frosted"], ["solid", "Solid"]]} />
          </Setting>
          <Setting title="List size" description="Compact fits more songs on screen"><Segmented name="density" options={[["comfortable", "Comfy"], ["compact", "Compact"]]} /></Setting>
          <Setting title="Colour the player" description="Tint the player with the cover's colour and, on a big screen, the whole page"><Toggle name="tint" /></Setting>
          <Setting title="Animations" description="Reduced only fades; Off keeps everything still" stack>
            <Segmented name="motion" options={[["full", "Full"], ["reduced", "Less"], ["off", "Off"]]} />
          </Setting>
        </Group>

        <BackgroundSettings />
        <PlayerSettings />

        <Group title="Text">
          <Setting title="Font" stack><Segmented name="font" options={[["rounded", "Rounded"], ["system", "Plain"], ["serif", "Serif"], ["mono", "Mono"]]} /></Setting>
          <Setting title="Text size"><Segmented name="textSize" options={[["small", "Small"], ["normal", "Normal"], ["large", "Large"]]} /></Setting>
        </Group>

        <Group title="Layout">
          <HomeSettings />
          <TabSettings />
          <Setting title="Library view" description="Cards or rows, in every section of the library"><Segmented name="libraryView" options={[["grid", "Grid"], ["list", "List"]]} /></Setting>
          <Setting title="Card size" description="Albums, playlists and artists, on Home and in the library"><Segmented name="cardSize" options={[["small", "Small"], ["medium", "Medium"], ["large", "Large"]]} /></Setting>
        </Group>

        <Group title="Playback">
          <Setting title="Count my plays" description="Lets “Recently played” and “Most played” work on the home screen"><Toggle name="scrobble" /></Setting>
        </Group>

        <DeviceSettings />

        <Group title="Offline">
          <Setting title="Offline mode" description="Use only what is saved on this device, even with a connection"><Toggle name="offlineMode" /></Setting>
          <Setting title="Saved on this device"><span>{usage}</span></Setting>
          <Setting title="Remove all saved songs" description="Frees the space they use">
            <button type="button" className={ui.pill} onClick={async () => {
              const saved = offline.list();
              if (!saved.length) { toast("Nothing is saved on this device"); return; }
              if (!confirm(`Remove ${plural(saved.length, "saved song")} from this device?`)) return;
              for (const s of saved) await offline.remove(s.id);
              toast("Removed from this device");
            }}><Icon name="trash" size={16} />Remove</button>
          </Setting>
        </Group>

        <Group title="Your music">
          <Setting title="Import a playlist" description="Make playlists from a file exported from Spotify or anywhere else">
            <Link className={ui.pill} to="/import"><Icon name="upload" size={16} />Import</Link>
          </Setting>
          {me?.admin && (
            <Setting title="Users" description="See who has an account and add someone">
              <Link className={ui.pill} to="/users"><Icon name="user" size={16} />Manage</Link>
            </Setting>
          )}
          {me?.admin && (
            <Setting title="Library clean-up" description="Songs you have twice, and artists that are really several people">
              <Link className={ui.pill} to="/cleanup"><Icon name="sparkle" size={16} />Review</Link>
            </Setting>
          )}
        </Group>

        <Group title="About">
          <Setting title="Library" description="Songs in your library"><span>{library.data ? plural(library.data.total, "song") : library.error ? "—" : "…"}</span></Setting>
          <Setting title="Server"><span className="text-muted">{location.host}</span></Setting>
          {me?.version && <Setting title="Version" description={releaseUrl(me.version) ? "What changed in each version" : undefined}>
            {releaseUrl(me.version)
              ? <a className="text-muted underline underline-offset-3 hover:text-text" href={releaseUrl(me.version)} target="_blank" rel="noopener noreferrer">{me.version}</a>
              : <span className="text-muted">{me.version}</span>}
          </Setting>}
          {me?.catalog && <Setting title="Song information" description={me.catalog.startsWith("MusicBrainz") ? "From MusicBrainz and the Cover Art Archive, made by volunteers, and iTunes for what they cannot answer" : undefined}><span className="text-muted">{me.catalog}</span></Setting>}
        </Group>

        <Group title="Account">
          <Setting title="Reset appearance" description="Back to the original look">
            <button type="button" className={ui.pill} onClick={() => { resetSettings(); toast("Settings reset"); }}>Reset</button>
          </Setting>
          <Setting title="Sign out" description={`Signed in as ${user}`}>
            <button type="button" className={ui.pill} onClick={signOut}>Sign out</button>
          </Setting>
        </Group>

        <Credit />
      </div>
    </>
  );
}
