// On a computer or a tablet: one bar floating over the page with going back, the places you chose, a search box that is
// always there, and your account. There is no sidebar: the page gets the width, and your library lives in the deck.
import { useEffect, useRef } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { username } from "../lib/api";
import { initials } from "../lib/format";
import { useRoomy } from "../lib/media";
import { activePlace, REQUIRED_PLACE, tabsFrom } from "../lib/nav";
import { cx } from "../lib/ui";
import { setSettings, useSettings } from "../stores/settings";
import { useSearchText } from "../stores/ui";
import { Icon } from "./Icon";

const plainButton = "tap size-9 flex-none grid place-items-center rounded-full text-muted hover:text-text hover:bg-ghost active:scale-[.94]";

export function TopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const text = useSearchText((s) => s.text);
  const chosen = useSettings((s) => s.tabs);
  const deck = useSettings((s) => s.nowPanel);
  const roomy = useRoomy();
  const input = useRef<HTMLInputElement>(null);
  const tabs = tabsFrom(chosen);
  const active = activePlace(tabs, pathname);

  // "/" jumps to the search box, as on most sites with one
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.matches("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="relative z-20 flex-none flex items-center gap-1.5 h-14 pl-3 pr-2 rounded-full bg-glass-strong backdrop-blur-2xl backdrop-saturate-150 shadow-[0_12px_32px_rgb(0_0_0/.22),inset_0_0_0_1px_var(--line)]">
      <Link to="/home" className="flex-none flex items-center gap-2 pr-1.5" aria-label="Eco, home">
        <img src={__LOGO_URL__} alt="" width="30" height="30" className="rounded-[9px]" />
        <span className="hidden min-[1000px]:inline font-title font-bold text-[1.25rem] tracking-[-.03em]">Eco</span>
      </Link>
      <button type="button" className={plainButton} aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" size={20} /></button>
      <button type="button" className={plainButton} aria-label="Forward" onClick={() => navigate(1)}><span className="inline-flex -scale-x-100"><Icon name="back" size={20} /></span></button>
      <nav className="flex-none flex items-center gap-0.5 mx-1" aria-label="Main">
        {/* Settings is behind your initials at the end of this bar */}
        {tabs.filter((place) => place.id !== REQUIRED_PLACE).map((place) => (
          <NavLink key={place.id} to={place.to} end title={place.label} data-on={place.id === active || undefined}
            className="tap flex items-center gap-2 h-10 px-3 rounded-full font-semibold text-[.92rem] text-muted hover:text-text data-on:bg-text data-on:text-bg">
            <Icon name={place.icon} size={19} />
            <span className={cx(place.id === active ? "inline" : "hidden min-[1000px]:inline")}>{place.label}</span>
          </NavLink>
        ))}
      </nav>
      <label className="relative flex-1 min-w-0 flex items-center h-10 ml-1 text-muted">
        <span className="absolute left-3 pointer-events-none inline-flex"><Icon name="search" size={18} /></span>
        <input ref={input} type="search" placeholder="Search songs, artists, albums" aria-label="Search" autoComplete="off" value={text}
          className="peer w-full h-full pl-10 pr-10 rounded-full border border-transparent bg-ghost text-text outline-none transition-colors duration-150 focus:border-accent placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
          // Not on focus: the box gets focus back whenever a window or a dialog closes, and that must not change the page
          onClick={() => { if (pathname !== "/search") navigate("/search"); }}
          onChange={(e) => { useSearchText.setState({ text: e.target.value }); if (pathname !== "/search") navigate("/search"); }} />
        <kbd className="absolute right-3 hidden can-hover:block peer-focus:hidden font-sans text-[.75rem] font-semibold text-muted px-1.5 rounded-md shadow-[inset_0_0_0_1px_var(--line)]">/</kbd>
      </label>
      {roomy && (
        <button type="button" className={cx(plainButton, deck && "text-accent")} aria-label="Show or hide the deck" title="Now playing and your library" aria-pressed={deck} onClick={() => setSettings({ nowPanel: !deck })}>
          <Icon name="panel" size={20} />
        </button>
      )}
      <Link to="/settings" title="Settings" aria-label="Settings" className="tap flex-none size-10 grid place-items-center rounded-full bg-ghost font-extrabold text-[.75rem] hover:bg-surface-3">{initials(username())}</Link>
    </header>
  );
}
