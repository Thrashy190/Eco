import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { getSongs, signOut, username, whoAmI } from "../lib/api";
import { plural } from "../lib/format";
import { pictureToCover } from "../lib/image";
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
import { ACCENTS, resetSettings, setSettings, useSettings, type Settings as SettingValues } from "../stores/settings";
import { openSheet, toast } from "../stores/ui";

/** A pill-shaped choice between a few options. */
function Segmented<K extends "theme" | "corners" | "density" | "motion" | "font" | "textSize" | "libraryView">({ name, options }: { name: K; options: [SettingValues[K], string][] }) {
  const value = useSettings((s) => s[name]);
  return (
    <div className={SEG} role="group">
      {options.map(([option, label]) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => setSettings({ [name]: option } as Partial<SettingValues>)}>{label}</button>
      ))}
    </div>
  );
}

const SEG = "flex p-0.75 gap-0.5 rounded-full bg-surface-2 [&>button]:flex-1 [&>button]:px-3 [&>button]:py-1.75 [&>button]:rounded-full [&>button]:font-[650] [&>button]:text-[.85rem] [&>button]:text-muted [&>button]:whitespace-nowrap [&>button[aria-pressed=true]]:bg-accent [&>button[aria-pressed=true]]:text-accent-ink [&>button[aria-pressed=true]]:shadow-[0_2px_10px_rgb(var(--glow)/.35)]";
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

function Toggle({ name }: { name: "tint" | "scrobble" | "offlineMode" | "dynamicAccent" }) {
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

  return (
    <>
      <header className={ui.heroCompact}><h1>Settings</h1></header>
      <div className="grid gap-5.5 px-4 pb-2 wide:px-8 @4xl:block @4xl:columns-2 @4xl:gap-6 @4xl:*:mb-6 @4xl:*:break-inside-avoid">
        <div className="flex items-center gap-4 p-4.5 rounded-[calc(var(--radius)+6px)] bg-[linear-gradient(135deg,rgb(var(--glow)/.22),var(--surface)_70%)] shadow-[inset_0_0_0_1px_var(--line)] [&_h2]:text-[1.3rem] [&_h2]:font-extrabold [&_h2]:tracking-[-.02em] [&_p]:text-muted [&_p]:text-[.88rem] [&_p]:mt-0.5">
          <ProfilePicture />
          <div><h2>{user}</h2><p>Your look is saved on this device. Your picture follows you to every device.</p></div>
        </div>

        <Group title="Appearance">
          <Setting title="Theme" description="Follows your phone unless you choose one" stack>
            <Segmented name="theme" options={[["system", "Auto"], ["dark", "Dark"], ["light", "Light"], ["black", "Black"]]} />
          </Setting>
          <Setting title="Dynamic colour" description="Buttons, highlights and the Eco logo take the colour of the album playing"><Toggle name="dynamicAccent" /></Setting>
          <Setting title="Accent colour" description="Buttons, highlights and the logo, when nothing is playing or dynamic colour is off" stack><Swatches /></Setting>
          <Preview />
          <Setting title="Corners"><Segmented name="corners" options={[["soft", "Soft"], ["sharp", "Sharp"]]} /></Setting>
          <Setting title="List size" description="Compact fits more songs on screen"><Segmented name="density" options={[["comfortable", "Comfy"], ["compact", "Compact"]]} /></Setting>
          <Setting title="Colour the player" description="Tint the player with the cover's colour and, on a big screen, the whole page"><Toggle name="tint" /></Setting>
          <Setting title="Animations" description="Reduced only fades; Off keeps everything still" stack>
            <Segmented name="motion" options={[["full", "Full"], ["reduced", "Less"], ["off", "Off"]]} />
          </Setting>
        </Group>

        <Group title="Text">
          <Setting title="Font" stack><Segmented name="font" options={[["rounded", "Rounded"], ["system", "Plain"], ["serif", "Serif"], ["mono", "Mono"]]} /></Setting>
          <Setting title="Text size"><Segmented name="textSize" options={[["small", "Small"], ["normal", "Normal"], ["large", "Large"]]} /></Setting>
        </Group>

        <Group title="Layout">
          <HomeSettings />
          <TabSettings />
          <Setting title="Library view" description="Cards or rows, in every section of the library"><Segmented name="libraryView" options={[["grid", "Grid"], ["list", "List"]]} /></Setting>
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
