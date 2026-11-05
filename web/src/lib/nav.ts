// The places the tab bar and the top bar can lead to. Which ones show, and in what order, is the user's choice.
import type { IconName } from "../components/Icon";

export interface Place {
  id: string;
  label: string;
  icon: IconName;
  to: string;
}

export const PLACES: Place[] = [
  { id: "home", label: "Home", icon: "home", to: "/home" },
  { id: "search", label: "Search", icon: "search", to: "/search" },
  { id: "library", label: "Library", icon: "library", to: "/library" },
  { id: "favorites", label: "Favorites", icon: "heart", to: "/playlist/favorites" },
  { id: "playlists", label: "Playlists", icon: "queue", to: "/library/playlists" },
  { id: "albums", label: "Albums", icon: "image", to: "/library/albums" },
  { id: "artists", label: "Artists", icon: "user", to: "/library/artists" },
  { id: "songs", label: "Songs", icon: "play", to: "/library/songs" },
  { id: "podcast", label: "Podcasts", icon: "volume", to: "/library/podcast" },
  { id: "audiobook", label: "Audiobooks", icon: "history", to: "/library/audiobook" },
  { id: "offline", label: "Downloads", icon: "offline", to: "/library/offline" },
  { id: "settings", label: "Settings", icon: "sliders", to: "/settings" },
];

/** Settings must stay reachable, or nobody could undo hiding it. A phone has room for five tabs. */
export const REQUIRED_PLACE = "settings";
export const MAX_TABS = 5;
export const DEFAULT_TABS = ["home", "search", "library", "settings"];

/** The chosen tabs: only places that exist, at most five, and Settings always among them. */
export function tabsFrom(chosen: readonly string[] | undefined): Place[] {
  const ids = (chosen ?? DEFAULT_TABS).filter((id, i, all) => all.indexOf(id) === i && PLACES.some((p) => p.id === id));
  if (!ids.includes(REQUIRED_PLACE)) ids.push(REQUIRED_PLACE);
  const fitting = ids.length > MAX_TABS ? [...ids.filter((id) => id !== REQUIRED_PLACE).slice(0, MAX_TABS - 1), REQUIRED_PLACE] : ids;
  return fitting.map((id) => PLACES.find((p) => p.id === id)!);
}

/** Which page an address shows. The sections of the library are one page, so changing section leaves the title and chips alone. */
export const pageKey = (pathname: string) => (pathname === "/library" || pathname.startsWith("/library/") ? "/library" : pathname);

const LIBRARY_SCREENS = new Set(["library", "artist", "album", "catalog-album", "album-lookup", "playlist", "import"]);

/** Which of the tabs stays lit on a screen: the one that leads exactly here, else Library for anything inside it. */
export function activePlace(tabs: Place[], pathname: string): string | undefined {
  const exact = tabs.find((p) => p.to === pathname);
  if (exact) return exact.id;
  const screen = pathname.split("/")[1] || "home";
  if (LIBRARY_SCREENS.has(screen) && tabs.some((p) => p.id === "library")) return "library";
  return tabs.find((p) => p.id === screen)?.id;
}

/** The sections of Home, in their original order. */
export const HOME_SECTIONS: [string, string][] = [
  ["recent", "Jump back in"], ["downloaded", "Just downloaded"], ["newest", "Recently added"], ["frequent", "Most played"], ["mix", "Mix for you"],
];

/** The saved order, with any section added since then at the end. */
export function homeOrder(saved: readonly string[] | undefined): string[] {
  const known = HOME_SECTIONS.map(([id]) => id);
  return [...(saved ?? []).filter((id) => known.includes(id)), ...known.filter((id) => !saved?.includes(id))];
}

/** Moves one item of a list up or down. */
export function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const out = [...list];
  const target = index + by;
  if (target < 0 || target >= out.length) return out;
  [out[index], out[target]] = [out[target], out[index]];
  return out;
}
