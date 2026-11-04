import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { getSongs, signOut, username, whoAmI } from "../lib/api";
import { initials, plural } from "../lib/format";
import { HOME_SECTIONS, homeOrder, MAX_TABS, moved, PLACES, REQUIRED_PLACE, tabsFrom } from "../lib/nav";
import { Credit } from "../components/common";
import { Icon, Ring } from "../components/Icon";
import { openDevicePicker } from "../components/Devices";
import { ME_KEY } from "../stores/admin";
import { myDeviceName, renameDevice, useConnect } from "../stores/connect";
import * as offline from "../stores/offline";
import { ACCENTS, resetSettings, setSettings, useSettings, type Settings as SettingValues } from "../stores/settings";
import { toast } from "../stores/ui";

/** A pill-shaped choice between a few options. */
function Segmented<K extends "theme" | "corners" | "density" | "motion" | "font" | "textSize" | "libraryView">({ name, options }: { name: K; options: [SettingValues[K], string][] }) {
  const value = useSettings((s) => s[name]);
  return (
    <div className="seg" role="group">
      {options.map(([option, label]) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => setSettings({ [name]: option } as Partial<SettingValues>)}>{label}</button>
      ))}
    </div>
  );
}

function Toggle({ name }: { name: "tint" | "scrobble" | "offlineMode" }) {
  const on = useSettings((s) => s[name]);
  return <button type="button" className="toggle-switch" role="switch" aria-checked={on} onClick={() => setSettings({ [name]: !on })} />;
}

function Setting({ title, description, stack, children }: { title: string; description?: string; stack?: boolean; children: ReactNode }) {
  return (
    <div className={`setting${stack ? " stack" : ""}`}>
      <div className="label"><b>{title}</b>{description && <span>{description}</span>}</div>
      {children}
    </div>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section><div className="group-title">{title}</div><div className="group">{children}</div></section>
);

function Swatches() {
  const accent = useSettings((s) => s.accent).toLowerCase();
  const isPreset = ACCENTS.some(([, color]) => color === accent);
  return (
    <div className="swatches">
      {ACCENTS.map(([name, color]) => (
        <button key={color} type="button" className="swatch" style={{ "--c": color } as React.CSSProperties} aria-label={name} title={name} aria-pressed={color === accent} onClick={() => setSettings({ accent: color })} />
      ))}
      <span className="swatch custom" title="Pick any colour" aria-pressed={!isPreset}>
        <input type="color" aria-label="Custom colour" value={accent} onChange={(e) => setSettings({ accent: e.target.value })} />
      </span>
    </div>
  );
}

/** A tiny sample so you can see what a choice does without leaving the screen. */
const Preview = () => (
  <div className="preview" aria-hidden="true">
    <div className="cover no-cover"><Icon name="play" size={20} /></div>
    <div className="text preview-text"><b>Sample song</b><span>Sample artist · Album</span></div>
    <Ring percent={65} size={28} />
    <span className="get"><Icon name="download" size={16} />Get</span>
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
    <ul className="reorder">
      {items.map(([id, label], i) => (
        <li key={id} className={isOn(id) ? "" : "off"}>
          <span className="reorder-label">{label}</span>
          <button type="button" className="icon-button" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => onMove(i, -1)}><Icon name="up" size={18} /></button>
          <button type="button" className="icon-button" aria-label={`Move ${label} down`} disabled={i === items.length - 1} onClick={() => onMove(i, 1)}><Icon name="down" size={18} /></button>
          {id !== locked
            ? <button type="button" className="toggle-switch" role="switch" aria-label={`Show ${label}`} aria-checked={isOn(id)} onClick={() => onToggle(id)} />
            : <span className="toggle-placeholder" title="Always here, so you can come back to Settings" />}
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
    <Setting title="Tabs" description={`Up to ${MAX_TABS} on a phone. On a computer they lead the sidebar.`} stack>
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
        <input className="device-name" value={name} maxLength={60} aria-label="Device name" onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (name.trim() !== myDeviceName()) renameDevice(name); }} />
      </Setting>
      <Setting title="Where music plays" description={`${plural(devices.length, "device")} signed in to your account right now`}>
        <button type="button" className="pill" onClick={openDevicePicker}><Icon name="devices" size={16} />Choose</button>
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
      <header className="hero compact"><h1>Settings</h1></header>
      <div className="settings">
        <div className="profile-card">
          <div className="avatar letters">{initials(user)}</div>
          <div><h2>{user}</h2><p>Your settings are saved on this device for this account.</p></div>
        </div>

        <Group title="Appearance">
          <Setting title="Theme" description="Follows your phone unless you choose one" stack>
            <Segmented name="theme" options={[["system", "Auto"], ["dark", "Dark"], ["light", "Light"], ["black", "Black"]]} />
          </Setting>
          <Setting title="Accent colour" description="Buttons, highlights and the active tab" stack><Swatches /></Setting>
          <Preview />
          <Setting title="Corners"><Segmented name="corners" options={[["soft", "Soft"], ["sharp", "Sharp"]]} /></Setting>
          <Setting title="List size" description="Compact fits more songs on screen"><Segmented name="density" options={[["comfortable", "Comfy"], ["compact", "Compact"]]} /></Setting>
          <Setting title="Colour the player" description="Tint the full-screen player with the cover's colour"><Toggle name="tint" /></Setting>
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
          <Setting title="Albums and artists" description="How the library lists them"><Segmented name="libraryView" options={[["grid", "Grid"], ["list", "List"]]} /></Setting>
        </Group>

        <Group title="Playback">
          <Setting title="Count my plays" description="Lets “Recently played” and “Most played” work on the home screen"><Toggle name="scrobble" /></Setting>
        </Group>

        <DeviceSettings />

        <Group title="Offline">
          <Setting title="Offline mode" description="Use only what is saved on this device, even with a connection"><Toggle name="offlineMode" /></Setting>
          <Setting title="Saved on this device"><span>{usage}</span></Setting>
          <Setting title="Remove all saved songs" description="Frees the space they use">
            <button type="button" className="pill" onClick={async () => {
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
            <Link className="pill" to="/import"><Icon name="upload" size={16} />Import</Link>
          </Setting>
          {me?.admin && (
            <Setting title="Library clean-up" description="Songs you have twice, and artists that are really several people">
              <Link className="pill" to="/cleanup"><Icon name="sparkle" size={16} />Review</Link>
            </Setting>
          )}
        </Group>

        <Group title="About">
          <Setting title="Library" description="Songs in your library"><span>{library.data ? plural(library.data.total, "song") : library.error ? "—" : "…"}</span></Setting>
          <Setting title="Server"><span className="muted">{location.host}</span></Setting>
          {me?.catalog && <Setting title="Song information" description={me.catalog.startsWith("MusicBrainz") ? "From MusicBrainz and the Cover Art Archive, made by volunteers, and iTunes for what they cannot answer" : undefined}><span className="muted">{me.catalog}</span></Setting>}
        </Group>

        <Group title="Account">
          <Setting title="Reset appearance" description="Back to the original look">
            <button type="button" className="pill" onClick={() => { resetSettings(); toast("Settings reset"); }}>Reset</button>
          </Setting>
          <Setting title="Sign out" description={`Signed in as ${user}`}>
            <button type="button" className="pill" onClick={signOut}>Sign out</button>
          </Setting>
        </Group>

        <Credit />
      </div>
    </>
  );
}
