// The screens: home, search, library, artist, album, playlist. Each takes the element to fill
// and returns an optional cleanup function. Every screen that shows a collection (favorites, a playlist,
// an album) falls back to what is saved on the device when there is no connection.
import { h, icon, section, empty, greeting, toast } from "./ui.js";
import { eco, subsonic, song as toSong, album as toAlbum, getAlbum, getArtist, getArtists, getPlaylists, getPlaylist, getStarred, username } from "./api.js";
import { songRow, externalRow, getAllButton, albumCard, artistCard, shelf, cover, go, downloadToggle, syncCollectionIfSaved } from "./components.js";
import { importPanel, isYoutubeLink, mediaLibrary } from "./media-view.js";
import * as player from "./player.js";
import * as offline from "./store.js";
import * as downloads from "./downloads.js";
import * as settings from "./settings.js";

const skeleton = (rows = 6) => h("div", { class: "skeleton" }, Array.from({ length: rows }, () => h("div", { class: "bar" })));
const songList = (songs, options) => h("ul", { class: "rows" }, songs.map((s, i) => songRow(s, songs, i, options)));
const pill = (label, name, run) => h("button", { class: "pill", onclick: run }, icon(name, 16), label);

/** Play / shuffle buttons for a list of songs, plus any extra controls (like a Download button). */
const playButtons = (songs, ...extra) => h("div", { class: "actions" },
  h("button", { class: "primary", onclick: () => player.play(songs, 0) }, icon("play", 20), "Play"),
  pill("Shuffle", "shuffle", () => player.playShuffled(songs)), ...extra);

const offlineBanner = () => h("div", { class: "banner" }, icon("wifi", 18), settings.get().offlineMode ? "Offline mode is on. Showing what you saved on this device." : "You are offline. Showing what you saved on this device.");

/** Saved collection → a row/card the user can open, whatever the server says. */
const collectionCover = (col) => { const first = offline.collectionSongs(col.id)[0]; return first ? cover(first, 300, "cover big") : h("div", { class: "cover big no-cover" }, icon("play", 24)); };
const collectionCard = (col) => h("a", { class: "card", href: col.route }, collectionCover(col), h("b", {}, col.title), h("span", {}, col.subtitle));
const collectionRow = (col) => h("li", { class: "row", onclick: () => go(col.route) }, collectionCover(col),
  h("div", { class: "text" }, h("b", {}, col.title), h("span", {}, `${col.subtitle} · ${col.songIds.length} songs`)),
  h("span", { class: "status" }, icon("check", 16)));

// ---------------- Home ----------------

export async function home(root) {
  root.append(h("header", { class: "hero" }, h("h1", {}, greeting()), h("p", {}, username() ? `Signed in as ${username()}` : "")));
  if (!settings.online()) return homeOffline(root);
  const body = h("div", {}, skeleton());
  root.append(body);
  let data;
  try { data = await eco("home"); } catch (e) { body.replaceChildren(empty(e.message)); return; }
  const parts = [];
  const albums = (list) => shelf(list.map((a) => albumCard(toAlbum(a))));
  if (data.recent.length) parts.push(section("Jump back in", albums(data.recent)));
  if (data.downloads.length) {
    const songs = data.downloads.filter((j) => j.library_id).map((j) => toSong({ id: j.library_id, title: j.title, artist: j.artist, album: j.album, cover: j.library_id }));
    if (songs.length) parts.push(section("Just downloaded", songList(songs, { hideAlbum: true })));
  }
  if (data.newest.length) parts.push(section("Recently added", albums(data.newest)));
  if (data.frequent.length) parts.push(section("Most played", albums(data.frequent)));
  if (data.random_songs.length) {
    const songs = data.random_songs.map(toSong);
    parts.push(section("Mix for you", songList(songs), pill("Shuffle", "shuffle", () => player.playShuffled(songs))));
  }
  if (!parts.length) {
    parts.push(h("div", { class: "welcome" }, h("h2", {}, "Your library is empty"), h("p", {}, "Search for a song or an artist and tap Get to download it."),
      h("button", { class: "primary", onclick: () => go("#/search") }, icon("search", 20), "Search")));
  }
  body.replaceChildren(...parts);
  return downloads.onReady(() => { if (location.hash.startsWith("#/home") || location.hash === "" || location.hash === "#/") go("#/home"); });
}

function homeOffline(root) {
  const cols = offline.collectionList().filter((c) => c.complete);
  const saved = offline.list().filter((m) => !m.kind).map((m) => offline.song(m.id));
  const spoken = offline.list().filter((m) => m.kind).map((m) => offline.song(m.id));
  root.append(offlineBanner());
  const parts = [];
  if (cols.length) parts.push(section("Downloaded", shelf(cols.map(collectionCard))));
  if (saved.length) parts.push(section("Saved songs", songList(saved), pill("Play", "play", () => player.play(saved, 0))));
  if (spoken.length) parts.push(section("Podcasts & more", songList(spoken, { hideAlbum: false })));
  root.append(...(parts.length ? parts : [h("div", { class: "welcome" }, h("h2", {}, "Nothing saved yet"),
    h("p", {}, "When you are online, tap Download on your favorites, a playlist or an album, or use the ⋯ menu on a song. It will be here without a connection."))]));
}

// ---------------- Search ----------------

let lastQuery = "";

export function search(root) {
  const input = h("input", { type: "search", placeholder: "Songs, artists, or paste a YouTube link…", autocomplete: "off", enterkeyhint: "search", value: lastQuery, "aria-label": "Search" });
  const results = h("div", { class: "results" });
  root.append(h("div", { class: "searchbar" }, icon("search", 20), input), results);
  let serial = 0, timer;

  const run = async () => {
    const q = input.value.trim();
    lastQuery = q;
    const mine = ++serial;
    if (q.length < 2) { results.replaceChildren(h("div", { class: "welcome" }, h("h2", {}, "Search everything"),
      h("p", {}, "Your library first, then songs you do not have yet. Paste a YouTube link to add a video, podcast or audiobook."))); return; }
    if (!settings.online()) { searchSaved(results, q); return; }
    if (isYoutubeLink(q)) { results.replaceChildren(importPanel(q)); return; }
    results.replaceChildren(skeleton(5));
    let data;
    try { data = await eco("search", { q }); } catch (e) { if (mine === serial) results.replaceChildren(empty(e.message)); return; }
    if (mine !== serial) return; // an older search finished late
    const parts = [];
    if (data.artists.length) parts.push(section("Artists", shelf(data.artists.map((a) => artistCard({ id: a.id, name: a.name, cover: a.cover, albumCount: a.album_count })))));
    const songs = data.songs.map(toSong);
    if (songs.length) parts.push(section("In your library", songList(songs)));
    if (data.external.length) {
      parts.push(section("Not in your library yet", h("ul", { class: "rows" }, data.external.map(externalRow)), getAllButton(data.external)));
    }
    if (data.warning) parts.push(h("p", { class: "note" }, data.warning));
    results.replaceChildren(...(parts.length ? parts : [empty(`Nothing found for “${q}”.`)]));
  };

  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 320); });
  input.addEventListener("search", run);
  run();
  if (!lastQuery) input.focus({ preventScroll: true });
}

/** Offline search: look only through what is saved on the device. */
function searchSaved(results, q) {
  const needle = q.toLowerCase();
  const songs = offline.list().concat([...new Set(offline.collectionList().flatMap((c) => c.songIds))].map((id) => offline.song(id)).filter(Boolean))
    .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
    .filter((m) => [m.title, m.artist, m.album].some((t) => (t || "").toLowerCase().includes(needle))).map((m) => offline.song(m.id));
  results.replaceChildren(offlineBanner(), songs.length ? section("Saved on this device", songList(songs)) : empty(`Nothing saved matches “${q}”.`));
}

// ---------------- Library ----------------

const LIBRARY_TABS = [["favorites", "Favorites"], ["songs", "Songs"], ["artists", "Artists"], ["albums", "Albums"], ["playlists", "Playlists"],
  ["podcast", "Podcasts"], ["audiobook", "Audiobooks"], ["video", "Videos"], ["other", "Other"], ["offline", "Downloads"]];
const OFFLINE_TABS = new Set(["favorites", "albums", "playlists", "podcast", "audiobook", "video", "other", "offline"]);

export function library(root, params) {
  const tabs = settings.online() ? LIBRARY_TABS : LIBRARY_TABS.filter(([key]) => OFFLINE_TABS.has(key));
  const active = tabs.some(([key]) => key === params[0]) ? params[0] : "favorites";
  const content = h("div", { class: "library-content" });
  root.append(...[h("header", { class: "hero compact" }, h("h1", {}, "Library")), settings.online() ? null : offlineBanner(),
    h("nav", { class: "segments", "aria-label": "Library sections" }, tabs.map(([key, label]) =>
      h("a", { href: `#/library/${key}`, class: key === active ? "active" : "" }, label, key === "offline" && offline.collectionList().length + offline.count() ? h("small", {}, offline.count()) : null))),
    content].filter(Boolean)); // append(null) would print the word "null"
  const media = (kind) => (box) => mediaLibrary(box, kind);
  return { favorites: libraryFavorites, songs: librarySongs, artists: libraryArtists, albums: libraryAlbums, playlists: libraryPlaylists,
    podcast: media("podcast"), audiobook: media("audiobook"), video: media("video"), other: media("other"), offline: libraryDownloads }[active](content);
}

const FAVORITES = { id: "favorites", kind: "favorites", title: "Favorites", subtitle: "Your favorites", route: "#/library/favorites" };

async function libraryFavorites(box) {
  box.append(skeleton());
  let songs = null;
  if (settings.online()) { try { songs = await getStarred(); } catch { songs = null; } }
  if (songs === null) { // no connection (or the server failed): the downloaded copy
    const saved = offline.collectionSongs("favorites");
    box.replaceChildren(saved.length
      ? h("div", {}, h("p", { class: "count" }, `${saved.length} favorites saved on this device`), playButtons(saved), songList(saved))
      : h("div", { class: "welcome" }, h("h2", {}, "Favorites are not downloaded"), h("p", {}, "Open this tab while online and tap Download to keep your favorites without a connection.")));
    return;
  }
  const download = downloadToggle(FAVORITES, async () => songs);
  box.replaceChildren(songs.length
    ? h("div", {}, h("p", { class: "count" }, `${songs.length} favorites, most recent first`), playButtons(songs, download), songList(songs))
    : h("div", { class: "welcome" }, h("h2", {}, "No favorites yet"), h("p", {}, "Open the ⋯ menu on a song, or tap the heart in the player, to add it here.")));
  syncCollectionIfSaved("favorites", songs);
}

function librarySongs(box) {
  const list = h("ul", { class: "rows" });
  const all = [];
  const more = h("div", { class: "more" });
  const count = h("p", { class: "count" });
  box.append(count, list, more);
  let offset = 0, loading = false, done = false;
  const load = async () => {
    if (loading || done) return;
    loading = true;
    try {
      const page = await eco("songs", { offset, limit: 100 });
      const songs = page.songs.map(toSong);
      songs.forEach((s) => { all.push(s); list.append(songRow(s, all, all.length - 1)); });
      offset += songs.length;
      done = !page.has_more;
      count.textContent = `${page.total} songs`;
      if (done) more.remove();
    } catch (e) { toast(e.message); done = true; }
    loading = false;
  };
  const watcher = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) load(); }, { rootMargin: "800px" });
  watcher.observe(more);
  load();
  return () => watcher.disconnect();
}

async function libraryArtists(box) {
  box.append(skeleton());
  try {
    const artists = (await getArtists()).sort((a, b) => a.name.localeCompare(b.name));
    const grid = h("div", { class: "grid" }, artists.map((a) => artistCard(a)));
    const filter = h("input", { type: "search", class: "filter", placeholder: `Filter ${artists.length} artists`, "aria-label": "Filter artists",
      oninput: (e) => { const q = e.target.value.toLowerCase(); [...grid.children].forEach((c, i) => { c.hidden = !artists[i].name.toLowerCase().includes(q); }); } });
    box.replaceChildren(filter, artists.length ? grid : empty("No artists yet."));
  } catch (e) { box.replaceChildren(empty(e.message)); }
}

async function libraryAlbums(box) {
  if (!settings.online()) {
    const saved = offline.collectionList("album").filter((c) => c.complete);
    box.append(saved.length ? h("div", { class: "grid" }, saved.map(collectionCard)) : empty("No albums are downloaded."));
    return;
  }
  box.append(skeleton());
  try {
    const albums = ((await subsonic("getAlbumList2", { type: "alphabeticalByName", size: 500 })).albumList2.album ?? []).map(toAlbum);
    box.replaceChildren(albums.length ? h("div", { class: "grid" }, albums.map(albumCard)) : empty("No albums yet."));
  } catch (e) { box.replaceChildren(empty(e.message)); }
}

async function libraryPlaylists(box) {
  if (!settings.online()) {
    const saved = offline.collectionList("playlist").filter((c) => c.complete);
    box.append(saved.length ? h("ul", { class: "rows" }, saved.map(collectionRow)) : empty("No playlists are downloaded."));
    return;
  }
  box.append(skeleton(4));
  try {
    const lists = await getPlaylists();
    box.replaceChildren(lists.length ? h("ul", { class: "rows" }, lists.map((p) =>
      h("li", { class: "row", onclick: () => go(`#/playlist/${p.id}`) }, cover(p.cover, 96),
        h("div", { class: "text" }, h("b", {}, p.name), h("span", {}, `${p.songCount} songs`)),
        offline.isCollectionSaved(`playlist:${p.id}`) ? h("span", { class: "status" }, icon("check", 16)) : null))) : empty("No playlists yet."));
  } catch (e) { box.replaceChildren(empty(e.message)); }
}

/** The "Downloads" tab: downloaded collections, then songs saved one by one, with the space they use. */
function libraryDownloads(box) {
  const draw = async () => {
    const cols = offline.collectionList().filter((c) => c.complete);
    const saved = offline.list().filter((m) => !m.kind).map((m) => offline.song(m.id));
    const spoken = offline.list().filter((m) => m.kind).map((m) => offline.song(m.id));
    if (!cols.length && !saved.length && !spoken.length) {
      box.replaceChildren(h("div", { class: "welcome" }, h("h2", {}, "Nothing downloaded yet"),
        h("p", {}, "Tap Download on your favorites, a playlist or an album, or open the ⋯ menu on any song and choose Save for offline. Downloads play without a connection.")));
      return;
    }
    const { used, quota } = await offline.usage();
    const parts = [h("p", { class: "count" }, `${offline.count()} songs · ${offline.megabytes(used)}${quota ? ` of ${offline.megabytes(quota)} available` : ""}`)];
    if (cols.length) parts.push(section("Collections", h("ul", { class: "rows" }, cols.map(collectionRow))));
    if (saved.length) parts.push(section("Songs", songList(saved), pill("Play", "play", () => player.play(saved, 0))));
    if (spoken.length) parts.push(section("Podcasts, audiobooks & more", songList(spoken)));
    parts.push(h("button", { class: "danger-link", onclick: async () => {
      if (!confirm("Remove every download from this device?")) return;
      for (const c of cols) await offline.removeCollection(c.id);
      for (const s of offline.list()) await offline.remove(s.id);
      toast("Downloads removed");
    } }, "Remove all downloads from this device"));
    box.replaceChildren(...parts);
  };
  draw();
  return offline.onChange(draw);
}

// ---------------- Artist / album / playlist ----------------

export async function artist(root, [id]) {
  const header = h("header", { class: "detail" }, h("div", { class: "avatar letters big", style: "--h:200" }, ""), h("div", { class: "info" }, h("h1", {}, "…")));
  const body = h("div", {}, skeleton());
  root.append(back(), header, body);
  if (!settings.online()) { body.replaceChildren(empty("Artist pages need a connection.")); return; }
  let info;
  try { info = await getArtist(id); } catch (e) { body.replaceChildren(empty(e.message)); return; }
  header.replaceChildren(info.cover ? cover(info.cover, 300, "avatar big") : h("div", { class: "avatar letters big", style: `--h:${[...info.name].reduce((a, c) => (a * 31 + c.codePointAt(0)) % 360, 0)}` }, info.name.slice(0, 2).toUpperCase()),
    h("div", { class: "info" }, h("h1", {}, info.name), h("p", {}, `${info.albums.length} ${info.albums.length === 1 ? "album" : "albums"} in your library`)));
  const songs = (await Promise.all(info.albums.map((a) => getAlbum(a.id).then((x) => x.songs).catch(() => [])))).flat();
  const parts = [];
  if (songs.length) parts.push(playButtons(songs));
  if (info.albums.length) parts.push(section("Albums", shelf(info.albums.map(albumCard))));
  if (songs.length) parts.push(section(`Songs (${songs.length})`, songList(songs, { hideAlbum: false })));
  const discover = h("div", {}, skeleton(3));
  parts.push(section("Not in your library yet", discover));
  body.replaceChildren(...parts);
  try {
    const found = (await eco("discover", { artist: info.name })).external;
    discover.replaceChildren(found.length ? h("div", {}, getAllButton(found), h("ul", { class: "rows" }, found.map(externalRow))) : empty("Nothing else to suggest right now."));
  } catch (e) { discover.replaceChildren(empty(e.message)); }
}

/** Header, buttons and songs of an album or playlist, from the server or from the downloaded copy. */
function collectionPage(body, { spec, title, subtitle, coverNode, songs, saved }) {
  const download = saved ? null : downloadToggle(spec, async () => songs);
  body.replaceChildren(...[
    saved ? offlineBanner() : null,
    h("header", { class: "detail" }, coverNode, h("div", { class: "info" }, h("h1", {}, title), h("p", {}, subtitle))),
    playButtons(songs, download), songList(songs, { numbered: spec.kind === "album", hideAlbum: spec.kind === "album" })].filter(Boolean));
}

export async function albumView(root, [id]) {
  const body = h("div", {}, skeleton());
  root.append(back(), body);
  const key = `album:${id}`;
  const fromDevice = () => {
    const col = offline.collection(key);
    if (!col?.complete) { body.replaceChildren(empty("This album is not downloaded.")); return; }
    collectionPage(body, { spec: col, title: col.title, subtitle: col.subtitle, coverNode: collectionCover(col), songs: offline.collectionSongs(key), saved: true });
  };
  if (!settings.online()) { fromDevice(); return; }
  try {
    const a = await getAlbum(id);
    const spec = { id: key, kind: "album", title: a.name, subtitle: a.artist, route: `#/album/${id}` };
    collectionPage(body, { spec, title: a.name, subtitle: a.year ? `${a.artist} · ${a.year}` : a.artist, coverNode: cover(a.cover, 400, "cover huge"), songs: a.songs });
    syncCollectionIfSaved(key, a.songs);
  } catch (e) { offline.collection(key)?.complete ? fromDevice() : body.replaceChildren(empty(e.message)); }
}

export async function playlistView(root, [id]) {
  const body = h("div", {}, skeleton());
  root.append(back(), body);
  const key = `playlist:${id}`;
  const fromDevice = () => {
    const col = offline.collection(key);
    if (!col?.complete) { body.replaceChildren(empty("This playlist is not downloaded.")); return; }
    collectionPage(body, { spec: col, title: col.title, subtitle: `${col.songIds.length} songs`, coverNode: collectionCover(col), songs: offline.collectionSongs(key), saved: true });
  };
  if (!settings.online()) { fromDevice(); return; }
  try {
    const p = await getPlaylist(id);
    const spec = { id: key, kind: "playlist", title: p.name, subtitle: "Playlist", route: `#/playlist/${id}` };
    collectionPage(body, { spec, title: p.name, subtitle: `${p.songs.length} songs`, coverNode: cover(p.cover, 400, "cover huge"), songs: p.songs });
    syncCollectionIfSaved(key, p.songs);
  } catch (e) { offline.collection(key)?.complete ? fromDevice() : body.replaceChildren(empty(e.message)); }
}

function back() {
  return h("button", { class: "back", onclick: () => history.back(), "aria-label": "Back" }, icon("back", 22), "Back");
}
