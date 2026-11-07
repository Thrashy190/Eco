// The sign-in gate, the shell (screen + tabs + player on a phone; page + top bar + deck on a big screen) and the routes.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";
import { HashRouter, NavLink, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router";
import { useSession, whoAmI } from "./lib/api";
import { useWide } from "./lib/media";
import { activePlace, pageKey, tabsFrom } from "./lib/nav";
import { queryClient } from "./lib/query";
import { Icon } from "./components/Icon";
import { Ambient, Player } from "./components/Player";
import { PasswordPrompt } from "./components/PasswordPrompt";
import { SheetHost, ToastHost } from "./components/Sheet";
import { TopBar } from "./components/TopBar";
import { ME_KEY } from "./stores/admin";
import { watchLook } from "./stores/look";
import { startConnect } from "./stores/connect";
import { pollJobs } from "./stores/downloads";
import * as offline from "./stores/offline";
import * as player from "./stores/player";
import { watchSaving } from "./stores/saving";
import { loadSettings, useOnline, useSettings, watchNetwork } from "./stores/settings";
import { closeSheet, toast } from "./stores/ui";
import { AddSong } from "./views/AddSong";
import { AlbumLookup, CatalogAlbumView } from "./views/CatalogAlbum";
import { Cleanup } from "./views/Cleanup";
import { AlbumView, ArtistByName, ArtistView, PlaylistView } from "./views/collections";
import { Home } from "./views/Home";
import { ImportDetailView, ImportView } from "./views/Import";
import { Library } from "./views/Library";
import { Login } from "./views/Login";
import { AddSongs, NewPlaylist } from "./views/PlaylistEditor";
import { Search } from "./views/Search";
import { Settings } from "./views/Settings";
import { Users } from "./views/Users";

function Tabs() {
  const { pathname } = useLocation();
  const chosen = useSettings((s) => s.tabs);
  const tabs = tabsFrom(chosen);
  const active = activePlace(tabs, pathname);
  return (
    <nav className="fixed z-30 inset-x-3 bottom-[calc(var(--safe-bottom)+10px)] max-w-140 mx-auto flex items-center justify-between gap-1 h-15 px-1.5 rounded-full bg-glass-strong backdrop-blur-2xl backdrop-saturate-150 shadow-[0_12px_32px_rgb(0_0_0/.3),inset_0_0_0_1px_var(--line)]" aria-label="Main">
      {tabs.map((place) => (
        <NavLink key={place.id} to={place.to} end aria-label={place.label} data-on={place.id === active || undefined}
          className="tap flex-1 min-w-0 flex items-center justify-center gap-2 h-12 px-2 rounded-full text-muted font-semibold text-[.9rem] active:scale-[.96] data-on:flex-none data-on:px-4 data-on:bg-text data-on:text-bg">
          <Icon name={place.icon} size={22} /><span className={place.id === active ? "inline" : "hidden"}>{place.label}</span>
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

  // A phone scrolls the window and a big screen the page itself; a section of the library keeps the same page
  useLayoutEffect(() => { window.scrollTo(0, 0); document.getElementById("view")?.scrollTo(0, 0); }, [pathname]);
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
        {/* Keyed by page, so only a new page animates in, not a section of the same one */}
        <main id="view" key={pageKey(pathname)}
          className="relative @container max-w-205 mx-auto min-h-screen pt-[calc(var(--safe-top)+6px)] pb-[calc(var(--tabs-h)+var(--safe-bottom)+24px)] animate-view-in in-[.has-player]:pb-[calc(var(--tabs-h)+var(--mini-h)+var(--safe-bottom)+32px)] wide:w-full wide:max-w-none wide:min-h-0 wide:flex-1 wide:overflow-y-auto wide:scroll-pt-3 wide:pt-3 wide:pb-10 wide:mask-[linear-gradient(to_bottom,transparent,black_12px)] wide:in-[.has-player]:pb-10 wide:in-[.has-capsule]:pb-28 wide:[scrollbar-width:thin] wide:[scrollbar-color:var(--surface-3)_transparent]">
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
    const stopLook = watchLook(); // after loadSettings: what this device had shows at once, the account's look follows
    return () => { left = true; stopSaving?.(); stopNetwork(); stopLook(); };
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
          <Route path="playlist/new" element={<NewPlaylist />} />
          <Route path="playlist/:id" element={<PlaylistView />} />
          <Route path="playlist/:id/add" element={<AddSongs />} />
          <Route path="add-song" element={<AddSong />} />
          <Route path="import" element={<ImportView />} />
          <Route path="import/:id" element={<ImportDetailView />} />
          <Route path="cleanup" element={<Cleanup />} />
          <Route path="settings" element={<Settings />} />
          <Route path="users" element={<Users />} />
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
      <PasswordPrompt />
      <ToastHost />
    </>
  );
}
