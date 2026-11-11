// Pieces of the forms that describe a song: adding one by hand (views/AddSong.tsx) and editing one (views/EditSong.tsx).
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import * as api from "../lib/api";
import { ui } from "../lib/ui";
import { toast } from "../stores/ui";
import { Icon } from "./Icon";

export const PAGE = "grid gap-5 px-5 pt-2 pb-10 wide:px-8 max-w-190";
export const LABEL = "grid gap-1.5 [&>span]:text-[.75rem] [&>span]:uppercase [&>span]:tracking-[.09em] [&>span]:text-muted [&>span]:font-bold [&>span]:px-1.5";
export const PANEL = "grid gap-1 p-2 rounded-[22px] bg-glass-strong shadow-[inset_0_0_0_1px_var(--line)]";
export const OPTION = "tap flex items-center gap-3 w-full min-h-14 px-2.5 py-1.5 rounded-2xl text-left hover:bg-hover active:bg-ghost";
export const BADGE = "flex-none px-2 py-0.5 rounded-full bg-ghost text-[.72rem] font-bold text-muted";
export const NUMBER = "w-24 px-4 py-2.75 rounded-full border border-transparent bg-ghost outline-none focus:border-accent tabular-nums";

export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Artists of a song or album: chips, plus a box that suggests the library's artists and accepts new ones. */
export function ArtistsField({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (names: string[]) => void; placeholder: string }) {
  const { data: library = [] } = useQuery({ queryKey: ["artists"], queryFn: api.getArtists });
  const [text, setText] = useState("");
  const typed = text.trim();
  const known = (name: string) => library.some((a) => same(a.name, name));
  const suggestions = typed.length === 0 ? [] : library.filter((a) => a.name.toLowerCase().includes(typed.toLowerCase()) && !value.some((v) => same(v, a.name))).slice(0, 6);
  const add = (name: string) => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (clean.includes(";")) { toast("A name cannot hold a semicolon"); return; }
    if (!value.some((v) => same(v, clean))) onChange([...value, clean]);
    setText("");
  };
  return (
    <div className={LABEL}>
      <span>{label}</span>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((name) => (
            <span key={name} className="inline-flex items-center gap-1.5 pl-3.5 pr-1 py-1 rounded-full bg-ghost font-bold text-[.9rem]">
              {name}{!known(name) && <span className="text-[.7rem] font-bold text-accent">NEW</span>}
              <button type="button" className="tap size-7 grid place-items-center rounded-full text-muted hover:text-text" aria-label={`Remove ${name}`} onClick={() => onChange(value.filter((v) => v !== name))}><Icon name="close" size={14} /></button>
            </span>
          ))}
        </div>
      )}
      <input className={ui.input} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(suggestions.find((a) => same(a.name, typed))?.name ?? typed); } }} />
      {typed && (
        <div className={PANEL}>
          {suggestions.map((a) => (
            <button key={a.id} type="button" className={OPTION} onClick={() => add(a.name)}>
              <span className="flex-1 min-w-0 truncate font-[650]">{a.name}</span><span className={BADGE}>In your library</span>
            </button>
          ))}
          {!suggestions.some((a) => same(a.name, typed)) && !value.some((v) => same(v, typed)) && (
            <button type="button" className={OPTION} onClick={() => add(typed)}>
              <Icon name="plus" size={18} /><span className="flex-1 min-w-0 truncate font-[650]">{`Add “${typed}” as a new artist`}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
