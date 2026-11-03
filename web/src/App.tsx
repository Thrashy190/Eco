// The sign-in gate, the shell (screen + tabs + player, or panels on a big screen) and the routes.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";
import { HashRouter, NavLink, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router";
import { useSession, whoAmI } from "./lib/api";
import { useWide } from "./lib/media";
import { activePlace, tabsFrom } from "./lib/nav";
import { queryClient } from "./lib/query";
import { Icon } from "./components/Icon";
import { Player } from "./components/Player";
import { SheetHost, ToastHost } from "./components/Sheet";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ME_KEY } from "./stores/admin";
import { startConnect } from "./stores/connect";
import { pollJobs } from "./stores/downloads";
import * as offline from "./stores/offline";
import * as player from "./stores/player";
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
    <nav className="tabs" aria-label="Main">
      {tabs.map((place) => (
        <NavLink key={place.id} to={place.to} end className={place.id === active ? "active" : ""}>
          <Icon name={place.icon} size={24} /><span>{place.label}</span>
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
    <div className="shell">
      {wide && <TopBar />}
      {wide && <Sidebar />}
      {/* Keyed by address, so a new page also starts scrolled to the top where the page itself is what scrolls */}
      <main id="view" className="enter" key={pathname}><Outlet /></main>
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
    void offline.init();
    pollJobs();
    return watchNetwork((connected) => toast(connected ? "Back online" : "You are offline"));
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
