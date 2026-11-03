// Reusable pieces: covers, song rows, album and artist cards, the "more" sheet and the download button.
import { h, icon, ring, clock, initials, hue, toast } from "./ui.js";
import { coverUrl, mediaThumbUrl, song as toSong, star, unstar } from "./api.js";
import * as settings from "./settings.js";
import * as player from "./player.js";
import * as offline from "./store.js";
import * as downloads from "./downloads.js";

export const go = (hash) => { location.hash = hash; };

/** A square cover. Saved songs keep working offline, using the cover stored with them. */
export function cover(songOrId, size = 120, className = "cover") {
  const isSong = typeof songOrId === "object" && songOrId !== null;
  const id = isSong ? songOrId.cover : songOrId;
  const img = h("img", { class: className, alt: "", loading: "lazy", draggable: "false" });
  const savedId = isSong ? songOrId.id : null;
  if (!settings.online() && savedId && offline.isSaved(savedId)) {
    offline.savedCoverUrl(savedId).then((url) => { if (url) img.src = url; });
  } else if (isSong && songOrId.mediaId) {
    img.src = mediaThumbUrl(songOrId.mediaId);
  } else if (id) {
    img.src = coverUrl(id, size);
  } else {
    return h("div", { class: `${className} no-cover` }, icon("play", 20));
  }
  img.addEventListener("error", () => img.replaceWith(h("div", { class: `${className} no-cover` }, icon("play", 20))), { once: true });
  return img;
}

// ---- Bottom sheet ----

export function openSheet(title, subtitle, items) {
  const close = () => { backdrop.classList.remove("show"); setTimeout(() => backdrop.remove(), 180); };
  const body = h("div", { class: "sheet", role: "dialog", "aria-label": title },
    h("div", { class: "sheet-head" }, h("b", {}, title), h("span", {}, subtitle)),
    ...items.filter(Boolean).map((item) => h("button", { class: "sheet-item" + (item.danger ? " danger" : ""), onclick: () => { close(); item.run(); } }, icon(item.icon, 20), item.label)));
  const backdrop = h("div", { class: "backdrop", onclick: (e) => { if (e.target === backdrop) close(); } }, body);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("show"));
}

// ---- Saving a song to the device ----

const saving = new Map(); // song id → percent

export async function saveOffline(song) {
  if (offline.isSaved(song.id) || saving.has(song.id)) return;
  if (!offline.supported()) { toast("Offline storage is not available in this browser"); return; }
  saving.set(song.id, 0);
  paintStatus(song.id);
  try {
    await offline.save(song, (p) => { saving.set(song.id, p); paintStatus(song.id); });
    toast(`Saved “${song.title}” for offline`);
  } catch (e) {
    toast(e.message);
  } finally {
    saving.delete(song.id);
    paintStatus(song.id);
  }
}

export async function removeOffline(song) {
  await offline.remove(song.id);
  toast("Removed from this device");
}

function paintStatus(id) {
  for (const row of document.querySelectorAll(`.row[data-id="${CSS.escape(id)}"] .status`)) {
    row.replaceChildren(statusFor(id));
  }
}

function statusFor(id) {
  if (saving.has(id)) return ring(saving.get(id));
  return offline.isSaved(id) ? h("span", { class: "saved", title: "Saved on this device" }, icon("offline", 16)) : document.createComment("");
}

function markPlaying() {
  const id = player.current()?.id;
  const on = player.isPlaying();
  for (const row of document.querySelectorAll(".row[data-id]")) {
    row.classList.toggle("current", row.dataset.id === id);
    row.classList.toggle("playing", row.dataset.id === id && on);
  }
}
player.onChange(markPlaying);
offline.onChange(() => document.querySelectorAll(".row[data-id]").forEach((row) => paintStatus(row.dataset.id)));

// ---- Song rows ----

/** Add or remove a song from the favourites. Updates the song object so every screen agrees. */
export async function toggleFavorite(song) {
  try {
    if (song.starred) { await unstar(song.id); song.starred = ""; toast("Removed from favorites"); }
    else { await star(song.id); song.starred = new Date().toISOString(); toast("Added to favorites"); }
  } catch (e) { toast(e.message); }
  document.dispatchEvent(new CustomEvent("eco:favorite", { detail: song }));
}

export function songMenu(song) {
  const saved = offline.isSaved(song.id);
  openSheet(song.title, song.artist, [
    { icon: song.starred ? "heart-fill" : "heart", label: song.starred ? "Remove from favorites" : "Add to favorites", run: () => toggleFavorite(song) },
    { icon: "play", label: "Play next", run: () => player.playNext(song) },
    { icon: "queue", label: "Add to queue", run: () => player.enqueue(song) },
    saved ? { icon: "trash", label: "Remove from this device", danger: true, run: () => removeOffline(song) }
      : { icon: "offline", label: "Save for offline", run: () => saveOffline(song) },
    song.artistId && { icon: "user", label: "Go to artist", run: () => go(`#/artist/${song.artistId}`) },
    song.albumId && { icon: "library", label: "Go to album", run: () => go(`#/album/${song.albumId}`) },
  ]);
}

/** A song in the library. Tapping it plays the whole list from here. */
export function songRow(song, list, index, options = {}) {
  const row = h("li", { class: "row", "data-id": song.id, onclick: () => player.play(list, index) },
    options.numbered ? h("span", { class: "num" }, index + 1) : cover(song, 96),
    h("div", { class: "text" }, h("b", {}, song.title), h("span", {}, [song.artist, !options.hideAlbum && song.album].filter(Boolean).join(" · "))),
    h("span", { class: "status" }, statusFor(song.id)),
    h("span", { class: "time" }, song.duration ? clock(song.duration) : ""),
    h("button", { class: "icon-button", "aria-label": "More", onclick: (e) => { e.stopPropagation(); songMenu(song); } }, icon("more", 20)));
  if (song.id === player.current()?.id) row.classList.add("current");
  return row;
}

// ---- Download a whole collection (favorites, a playlist, an album) for offline ----

const working = new Map(); // collection id → { done, total, percent } while it downloads

/**
 * A Spotify-style "Download" button. spec = { id, kind, title, subtitle }; getSongs returns the songs to save.
 * Saved collections show a check; tapping it asks before removing. New songs are picked up by syncCollectionIfSaved.
 */
export function downloadToggle(spec, getSongs) {
  const button = h("button", { class: "pill download-toggle", type: "button" });
  const draw = () => {
    if (!button.isConnected && button.dataset.seen) { document.removeEventListener("eco:collection", draw); return; }
    if (button.isConnected) button.dataset.seen = "1";
    const progress = working.get(spec.id);
    button.classList.toggle("on", offline.isCollectionSaved(spec.id));
    if (progress) {
      const pct = progress.total ? ((progress.done + Math.max(progress.percent, 0) / 100) / progress.total) * 100 : 0;
      button.replaceChildren(ring(pct, 18), `${Math.min(progress.done + 1, progress.total)}/${progress.total}`);
    } else if (offline.isCollectionSaved(spec.id)) {
      button.replaceChildren(icon("check", 16), "Downloaded");
    } else {
      button.replaceChildren(icon("offline", 16), "Download");
    }
  };
  button.addEventListener("click", async () => {
    if (working.has(spec.id)) return;
    if (offline.isCollectionSaved(spec.id)) {
      if (confirm(`Remove “${spec.title}” from this device?`)) { await offline.removeCollection(spec.id); toast("Download removed"); draw(); }
      return;
    }
    if (!offline.supported()) { toast("Offline storage is not available in this browser"); return; }
    if (!settings.online()) { toast("Connect to the internet to download"); return; }
    let songs;
    try { songs = await getSongs(); } catch (e) { toast(e.message); return; }
    if (!songs.length) { toast("Nothing to download yet"); return; }
    working.set(spec.id, { done: 0, total: songs.length, percent: 0 });
    document.dispatchEvent(new CustomEvent("eco:collection"));
    try {
      await offline.saveCollection(spec, songs, (done, total, percent) => { working.set(spec.id, { done, total, percent }); document.dispatchEvent(new CustomEvent("eco:collection")); });
      toast(`“${spec.title}” is ready offline`);
    } catch (e) { toast(`Download stopped: ${e.message}`); }
    working.delete(spec.id);
    document.dispatchEvent(new CustomEvent("eco:collection"));
  });
  document.addEventListener("eco:collection", draw);
  draw();
  return button;
}

/** When a downloaded collection is opened online, quietly fetch what is new and drop what was removed. */
export async function syncCollectionIfSaved(id, songs) {
  if (!offline.isCollectionSaved(id) || working.has(id) || !settings.online()) return;
  working.set(id, { done: 0, total: songs.length, percent: 0 });
  document.dispatchEvent(new CustomEvent("eco:collection"));
  try {
    const { added } = await offline.syncCollection(id, songs, (done, total) => { working.set(id, { done, total, percent: 0 }); document.dispatchEvent(new CustomEvent("eco:collection")); });
    if (added) toast(`${added} new ${added === 1 ? "song" : "songs"} downloaded`);
  } catch { /* try again next time */ }
  working.delete(id);
  document.dispatchEvent(new CustomEvent("eco:collection"));
}

// ---- Songs you can download ----

/** The button on a song that is not in the library yet. It follows the server's job for that song. */
function downloadControl(ext, row, onOwned) {
  const slot = h("span", { class: "download" });
  let stop;
  const draw = (job) => {
    // the row left the page (a new search, another screen): stop following its job
    if (slot.isConnected) slot.dataset.seen = "1";
    else if (slot.dataset.seen) { stop?.(); return; }
    if (!job) {
      slot.replaceChildren(h("button", { class: "get", "aria-label": `Download ${ext.title}`, onclick: (e) => { e.stopPropagation(); start(); } }, icon("download", 18), "Get"));
      return;
    }
    const label = { queued: "Queued", searching: "Finding…", downloading: `${Math.round(job.progress)}%`, tagging: "Finishing…" }[job.state];
    if (job.state === "error") {
      slot.replaceChildren(h("button", { class: "get retry", title: job.error, onclick: (e) => { e.stopPropagation(); toast(job.error); start(); } }, "Retry"));
    } else if (job.state === "ready") {
      slot.replaceChildren(h("span", { class: "done" }, icon("check", 18)));
      if (job.library_id) onOwned(job);
    } else {
      // spin until real progress arrives, then fill the ring
      const percent = job.state === "downloading" && job.progress > 0 ? job.progress : -1;
      slot.replaceChildren(ring(percent), h("span", { class: "label" }, label));
    }
  };
  const start = async () => {
    slot.replaceChildren(ring(-1), h("span", { class: "label" }, "Queued"));
    try { await downloads.request(ext.spotify_id); } catch (e) { toast(e.message); draw(null); }
  };
  stop = downloads.watch(ext.spotify_id, draw);
  if (!downloads.jobFor(ext.spotify_id)) draw(null);
  return slot;
}

/** A Spotify result not in the library. Once downloaded it turns into a normal, playable row. */
export function externalRow(ext) {
  const asSong = (job) => toSong({ id: job.library_id, title: ext.title, artist: ext.artist, album: ext.album, duration: ext.duration, cover: job.library_id });
  const row = h("li", { class: "row external", "data-spotify": ext.spotify_id },
    ext.cover_url ? h("img", { class: "cover", src: ext.cover_url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : h("div", { class: "cover no-cover" }, icon("play", 20)),
    h("div", { class: "text" }, h("b", {}, ext.title), h("span", {}, [ext.artist, ext.album].filter(Boolean).join(" · "))));
  row.append(downloadControl(ext, row, (job) => {
    row.classList.add("owned");
    row.dataset.id = job.library_id;
    row.onclick = () => player.play([asSong(job)], 0);
  }));
  return row;
}

/** A "Get all" button for a list of external songs. */
export function getAllButton(externals) {
  const pending = () => externals.filter((e) => !downloads.jobFor(e.spotify_id));
  return h("button", { class: "pill", onclick: async (e) => {
    const todo = pending();
    if (!todo.length) { toast("Everything here is already on its way"); return; }
    e.currentTarget.disabled = true;
    toast(`Downloading ${todo.length} songs`);
    for (const ext of todo) { try { await downloads.request(ext.spotify_id); } catch (err) { toast(err.message); break; } }
  } }, icon("download", 16), `Get all ${externals.length}`);
}

// ---- Cards ----

export function albumCard(a) {
  return h("a", { class: "card", href: `#/album/${a.id}` }, cover(a.cover, 300, "cover big"), h("b", {}, a.name), h("span", {}, a.artist));
}

export function artistCard(a, className = "card artist") {
  const avatar = a.cover ? cover(a.cover, 200, "avatar") : h("div", { class: "avatar letters", style: `--h:${hue(a.name)}` }, initials(a.name));
  return h("a", { class: className, href: `#/artist/${a.id}` }, avatar, h("b", {}, a.name), h("span", {}, a.albumCount != null ? `${a.albumCount} ${a.albumCount === 1 ? "album" : "albums"}` : "Artist"));
}

/** A horizontal strip of cards. */
export const shelf = (cards) => h("div", { class: "shelf" }, cards);
