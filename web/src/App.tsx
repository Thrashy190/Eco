// The sign-in gate, the shell (screen + tabs + player on a phone; page + top bar + deck on a big screen) and the routes.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";
import { HashRouter, NavLink, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router";
import { useSession, whoAmI } from "./lib/api";
import { useWide } from "./lib/media";
import { activePlace, tabsFrom } from "./lib/nav";
import { queryClient } from "./lib/query";
import { Icon } from "./components/Icon";
import { Ambient, Player } from "./components/Player";
import { SheetHost, ToastHost } from "./components/Sheet";
import { TopBar } from "./components/TopBar";
import { ME_KEY } from "./stores/admin";
import { startConnect } from "./stores/connect";
import { pollJobs } from "./stores/downloads";
import * as offline from "./stores/offline";
import * as player from "./stores/player";
import { watchSaving } from "./stores/saving";
import { loadSettings, useOnline, useSettings, watchNetwork } from "./stores/settings";
import { closeSheet, toast } from "./stores/ui";
import { AlbumLookup, CatalogAlbumView } from "./views/CatalogAlbum";
import { Cleanup } from "./views/Cleanup";
import { AlbumView, ArtistByName, ArtistView, PlaylistView } from "./views/collections";
import { Home } from "./views/Home";
import { ImportDetailView, ImportView } from "./views/Import";
import { Library } from "./views/Library";
import { Login } from "./views/Login";
import { Search } from "./views/Search";
import { Settings } from "./views/Settings";

function Tabs() {
  const { pathname } = useLocation();
  const chosen = useSettings((s) => s.tabs);
  const tabs = tabsFrom(chosen);
  const active = activePlace(tabs, pathname);
  return (
    <nav className="fixed z-30 inset-x-0 bottom-0 flex justify-center pb-(--safe-bottom) bg-glass border-t border-line backdrop-blur-[22px] backdrop-saturate-[1.6]" aria-label="Main">
      {tabs.map((place) => (
        <NavLink key={place.id} to={place.to} end data-on={place.id === active || undefined}
          className="group/tab flex-1 max-w-40 h-(--tabs-h) grid place-items-center content-center gap-0.5 text-muted text-[.7rem] font-semibold tracking-[.02em] transition-colors duration-150 data-on:text-accent">
          <span className="inline-flex transition-transform duration-250 ease-spring group-data-on/tab:-translate-y-0.5 group-data-on/tab:scale-[1.12]"><Icon name={place.icon} size={24} /></span><span>{place.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** With a keyboard: space plays and pauses, unless you are typing or on a button that space would press. */
function useKeyboard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !(e.target instanceof HTMLElement) || e.target.matches("input, textarea, select, button, a, [contenteditable]")) return;
      e.preventDefault();
      player.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

function Shell() {
  const { pathname } = useLocation();
  const screen = pathname.split("/")[1] || "home";
  const wide = useWide();
  useKeyboard(wide);

  useLayoutEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => { closeSheet(); }, [pathname]);
  useEffect(() => {
    document.title = screen === "home" ? "Eco" : `${screen[0].toUpperCase()}${screen.slice(1).replace("-", " ")} · Eco`;
  }, [screen]);

  return (
    <div className="wide:fixed wide:inset-0 wide:grid wide:grid-cols-[minmax(0,1fr)_auto] wide:gap-3 wide:p-3 wide:pt-[calc(var(--safe-top)+12px)] wide:pb-[calc(var(--safe-bottom)+12px)]">
      <Ambient />
      {/* The bar has its own row, so the page's scrollbar starts below it instead of running underneath */}
      <div className="wide:relative wide:flex wide:flex-col wide:gap-1 wide:min-w-0 wide:min-h-0">
        {wide && <TopBar />}
        {/* Keyed by address, so a new page also starts scrolled to the top where the page itself is what scrolls */}
        <main id="view" key={pathname}
          className="max-w-205 mx-auto min-h-screen pt-[calc(var(--safe-top)+6px)] pb-[calc(var(--tabs-h)+var(--safe-bottom)+24px)] animate-view-in in-[.has-player]:pb-[calc(var(--tabs-h)+var(--mini-h)+var(--safe-bottom)+32px)] wide:@container wide:w-full wide:max-w-none wide:min-h-0 wide:flex-1 wide:overflow-y-auto wide:scroll-pt-3 wide:pt-3 wide:pb-10 wide:mask-[linear-gradient(to_bottom,transparent,black_12px)] wide:in-[.has-player]:pb-10 wide:in-[.has-capsule]:pb-28 wide:[scrollbar-width:thin] wide:[scrollbar-color:var(--surface-3)_transparent]">
          <div className="wide:max-w-[1400px] wide:mx-auto"><Outlet /></div>
        </main>
      </div>
      {!wide && <Tabs />}
      <Player />
    </div>
  );
}

/** Addresses from when the catalogue was Spotify. Bookmarks and home-screen shortcuts must still land somewhere. */
function OldAlbumAddress() {
  const { id = "" } = useParams();
  return <Navigate to={`/catalog-album/${id}`} replace />;
}

function SignedIn({ user }: { user: string }) {
  const online = useOnline();
  useQuery({ queryKey: ME_KEY, queryFn: whoAmI, enabled: online, staleTime: 5 * 60_000 });
  useEffect(() => (online ? startConnect() : undefined), [online, user]);
  useEffect(() => {
    loadSettings(user);
    let stopSaving: (() => void) | undefined;
    let left = false;
    void offline.init().then(() => { if (!left) stopSaving = watchSaving(); });
    pollJobs();
    const stopNetwork = watchNetwork((connected) => toast(connected ? "Back online" : "You are offline"));
    return () => { left = true; stopSaving?.(); stopNetwork(); };
  }, [user]);

  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="home" element={<Home />} />
          <Route path="search" element={<Search />} />
          <Route path="library" element={<Library />} />
          <Route path="library/:tab" element={<Library />} />
          <Route path="artist/name/:name" element={<ArtistByName />} />
          <Route path="artist/:id" element={<ArtistView />} />
          <Route path="album/:id" element={<AlbumView />} />
          <Route path="catalog-album/:id" element={<CatalogAlbumView />} />
          <Route path="album-lookup" element={<AlbumLookup />} />
          <Route path="spotify-album/:id" element={<OldAlbumAddress />} />
          <Route path="playlist/:id" element={<PlaylistView />} />
          <Route path="import" element={<ImportView />} />
          <Route path="import/:id" element={<ImportDetailView />} />
          <Route path="cleanup" element={<Cleanup />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export function App() {
  const user = useSession((s) => s.session?.u);

  // Nothing fetched for one account may be shown to the next one
  useEffect(() => {
    if (!user) {
      queryClient.clear();
      loadSettings(""); // the device's last look
    }
  }, [user]);

  return (
    <>
      {user ? <SignedIn key={user} user={user} /> : <Login />}
      <SheetHost />
      <ToastHost />
    </>
  );
}
