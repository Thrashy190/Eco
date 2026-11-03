// On a computer or a tablet: going back and forward, and a search box that is always there.
import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { username } from "../lib/api";
import { initials } from "../lib/format";
import { useSearchText } from "../stores/ui";
import { Icon } from "./Icon";

export function TopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const text = useSearchText((s) => s.text);
  const input = useRef<HTMLInputElement>(null);

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
    <header className="topbar">
      <div className="topbar-nav">
        <button type="button" className="round" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" size={20} /></button>
        <button type="button" className="round" aria-label="Forward" onClick={() => navigate(1)}><span className="flip"><Icon name="back" size={20} /></span></button>
      </div>
      <Link className="round home" to="/home" aria-label="Home" title="Home"><Icon name="home" size={20} /></Link>
      <label className="topbar-search">
        <Icon name="search" size={20} />
        <input ref={input} type="search" placeholder="What do you want to listen to?" aria-label="Search" autoComplete="off" value={text}
          // Not on focus: the box gets focus back whenever a window or a dialog closes, and that must not change the page
          onClick={() => { if (pathname !== "/search") navigate("/search"); }}
          onChange={(e) => { useSearchText.setState({ text: e.target.value }); if (pathname !== "/search") navigate("/search"); }} />
      </label>
      <Link className="round avatar-button" to="/settings" title="Settings" aria-label="Settings">{initials(username())}</Link>
    </header>
  );
}
