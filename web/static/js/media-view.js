// Imported media: videos, podcasts, audiobooks and anything else pasted from a YouTube link.
// The import card (shown in Search when you paste a link) and the Library tabs for each category.
import { h, icon, ring, clock, toast, empty } from "./ui.js";
import * as api from "./api.js";
import * as player from "./player.js";
import * as offline from "./store.js";
import * as downloads from "./downloads.js";
import * as settings from "./settings.js";
import { openSheet, go, cover, saveOffline } from "./components.js";

const YOUTUBE = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;
export const isYoutubeLink = (text) => YOUTUBE.test(text.trim());

const skeleton = () => h("div", { class: "skeleton" }, h("div", { class: "bar" }), h("div", { class: "bar" }));
const CATEGORY_HINT = { podcast: "Episodes remember where you stopped and can play faster", audiobook: "Remembers your place and plays at your speed",
  video: "Plays in a full-screen video player", other: "Anything else: lectures, talks, sounds" };

// ---------------- Import card (Search) ----------------

export function importPanel(link) {
  const panel = h("div", { class: "import" }, skeleton());
  api.mediaPreview(link).then((preview) => panel.replaceChildren(...previewCard(link, preview))).catch((e) => panel.replaceChildren(h("div", { class: "welcome" }, h("h2", {}, "Could not read that link"), h("p", {}, e.message))));
  return panel;
}

function previewCard(link, preview) {
  const head = h("div", { class: "import-head" },
    h("div", { class: "import-thumb" }, preview.thumbnail ? h("img", { src: preview.thumbnail, alt: "", referrerpolicy: "no-referrer" }) : icon("play", 28),
      preview.duration ? h("span", { class: "badge" }, clock(preview.duration)) : null),
    h("div", { class: "import-info" }, h("b", {}, preview.title), h("span", {}, preview.channel)));

  if (preview.existing) {
    const where = api.kindLabel(preview.existing.kind);
    return [head, h("p", { class: "note" }, `Already in your library as ${where}.`),
      h("button", { class: "primary", onclick: () => go(`#/library/${preview.existing.kind}`) }, `Open ${where}`)];
  }
  if (preview.live) return [head, h("p", { class: "note" }, "This is a live stream, which cannot be imported.")];

  let kind = "podcast", format = "audio", touchedFormat = false;
  const kindRow = h("div", { class: "chips", role: "group", "aria-label": "What is it?" });
  const formatRow = h("div", { class: "seg", role: "group", "aria-label": "Download as" });
  const hint = h("p", { class: "note" });
  const quality = () => settings.get().videoQuality;
  const paint = () => {
    kindRow.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === kind)));
    formatRow.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.format === format)));
    hint.textContent = `${CATEGORY_HINT[kind]}.${format === "video" ? ` Up to ${quality()}p (change it in Settings).` : ""}`;
  };
  for (const [value, label] of api.KINDS) {
    kindRow.append(h("button", { type: "button", class: "chip", "data-kind": value, onclick: () => { kind = value; if (!touchedFormat) format = value === "video" ? "video" : "audio"; paint(); } }, label));
  }
  for (const [value, label] of [["audio", "Audio only"], ["video", "Video"]]) {
    formatRow.append(h("button", { type: "button", "data-format": value, onclick: () => { format = value; touchedFormat = true; paint(); } }, label));
  }
  paint();

  const action = h("div", { class: "import-action" });
  const start = h("button", { class: "primary", type: "button", onclick: async () => {
    start.disabled = true;
    try {
      const result = await downloads.requestMedia(link, kind, format, quality());
      if (result.existing) { toast("Already in your library"); go(`#/library/${result.existing.kind}`); return; }
      track(`media:${preview.id}`, action, kind);
    } catch (e) { toast(e.message); start.disabled = false; }
  } }, icon("download", 20), "Add to library");
  action.append(start);
  // A job that is still running (started earlier or from another device) is picked up again. A finished one is
  // history: the item may have been deleted since, so the card starts fresh.
  const running = downloads.jobFor(`media:${preview.id}`);
  if (running && running.state !== "ready" && running.state !== "error") track(`media:${preview.id}`, action, kind);
  return [head, h("div", { class: "group-title" }, "What is it?"), kindRow, h("div", { class: "group-title" }, "Download as"), formatRow, hint, action];
}

/** Show the progress of an import inside `slot` until it finishes. */
function track(key, slot, kind) {
  let stop;
  stop = downloads.watch(key, (job) => {
    if (!slot.isConnected && slot.dataset.seen) { stop?.(); return; }
    if (slot.isConnected) slot.dataset.seen = "1";
    if (job.state === "error") {
      slot.replaceChildren(h("p", { class: "note error-note" }, job.error), h("button", { class: "pill", onclick: () => location.reload() }, "Try again"));
    } else if (job.state === "ready") {
      const label = api.kindLabel(job.kind || kind);
      slot.replaceChildren(h("div", { class: "done-row" }, icon("check", 22), `Added to ${label}`), h("button", { class: "primary", onclick: () => go(`#/library/${job.kind || kind}`) }, `Open ${label}`));
    } else {
      const percent = job.state === "downloading" && job.progress > 0 ? job.progress : -1;
      slot.replaceChildren(h("div", { class: "done-row" }, ring(percent, 26), job.state === "downloading" ? `Downloading ${Math.round(job.progress)}%` : "Getting ready…"));
    }
  });
}

// ---------------- Library tabs ----------------

export async function mediaLibrary(box, kind) {
  const label = api.kindLabel(kind);
  const list = h("div", {});
  box.append(h("div", { class: "media-head" }, h("button", { class: "pill", onclick: () => go("#/search") }, icon("plus", 16), "Add from YouTube link")), list, skeleton());
  const draw = async () => {
    let items;
    if (settings.online()) {
      try { items = await api.listMedia(kind); } catch (e) { box.querySelector(".skeleton")?.remove(); list.replaceChildren(empty(e.message)); return; }
    } else { // offline: only what was saved on this device
      items = offline.list().filter((m) => m.kind === kind).map((m) => ({ id: m.mediaId, kind, format: m.format, title: m.title, channel: m.artist, duration: m.duration, size: m.size }));
    }
    box.querySelector(".skeleton")?.remove();
    if (!items.length) {
      list.replaceChildren(h("div", { class: "welcome" }, h("h2", {}, `No ${label.toLowerCase()}s yet`),
        h("p", {}, "Paste a YouTube link in Search, choose what it is, and it shows up here.")));
      return;
    }
    list.replaceChildren(kind === "video" || items.every((i) => i.format === "video") ? videoGrid(items, draw) : audioRows(items, draw));
  };
  draw();
  return downloads.onReady((job) => { if (job.kind === kind) draw(); });
}

const savedPercent = (item) => { const at = player.savedPosition(`m-${item.id}`); return item.duration && at ? Math.min(99, Math.round((at / item.duration) * 100)) : 0; };

function audioRows(items, refresh) {
  const songs = items.map(api.mediaSong);
  return h("ul", { class: "rows" }, items.map((item, i) => {
    const song = songs[i], pct = savedPercent(item);
    return h("li", { class: "row", "data-id": song.id, onclick: () => player.play(songs, i) },
      cover(song, 96),
      h("div", { class: "text" }, h("b", {}, item.title), h("span", {}, [item.channel, item.duration ? clock(item.duration) : "", pct ? `${pct}% played` : ""].filter(Boolean).join(" · "))),
      h("button", { class: "icon-button", "aria-label": "More", onclick: (e) => { e.stopPropagation(); itemMenu(item, song, refresh); } }, icon("more", 20)));
  }));
}

function videoGrid(items, refresh) {
  return h("div", { class: "grid videos" }, items.map((item) => {
    const pct = savedPercent(item);
    return h("div", { class: "card video", role: "button", tabindex: "0", onclick: () => openVideo(item) },
      h("div", { class: "thumb" }, h("img", { src: api.mediaThumbUrl(item.id), alt: "", loading: "lazy" }), h("span", { class: "badge" }, clock(item.duration)),
        pct ? h("i", { class: "progress", style: `width:${pct}%` }) : null),
      h("b", {}, item.title), h("span", {}, item.channel),
      h("button", { class: "icon-button corner", "aria-label": "More", onclick: (e) => { e.stopPropagation(); itemMenu(item, null, refresh); } }, icon("more", 20)));
  }));
}

function itemMenu(item, song, refresh) {
  const spoken = song && item.format !== "video";
  openSheet(item.title, item.channel, [
    spoken && (offline.isSaved(song.id)
      ? { icon: "trash", label: "Remove from this device", danger: true, run: async () => { await offline.remove(song.id); toast("Removed from this device"); refresh(); } }
      : { icon: "offline", label: "Save for offline", run: () => saveOffline(song) }),
    { icon: "trash", label: "Delete from library", danger: true, run: async () => {
      if (!confirm(`Delete “${item.title}” for good?`)) return;
      try {
        await api.deleteMedia(item.id);
        if (song) await offline.remove(song.id);
        try { localStorage.removeItem(`eco.pos.m-${item.id}`); localStorage.removeItem(`eco.pos.v-${item.id}`); } catch { /* ignore */ }
        toast("Deleted");
        refresh();
      } catch (e) { toast(e.message); }
    } },
  ]);
}

// ---------------- Video player ----------------

export function openVideo(item) {
  player.pause();
  const key = `eco.pos.v-${item.id}`;
  const at = Number(localStorage.getItem(key)) || 0;
  const video = h("video", { controls: true, playsinline: true, autoplay: true, src: api.mediaFileUrl(item.id), poster: api.mediaThumbUrl(item.id) });
  video.addEventListener("loadedmetadata", () => { if (at > 5 && at < video.duration - 10) video.currentTime = at; }, { once: true });
  let last = 0;
  video.addEventListener("timeupdate", () => { if (Math.abs(video.currentTime - last) >= 5) { last = video.currentTime; try { localStorage.setItem(key, String(Math.floor(video.currentTime))); } catch { /* ignore */ } } });
  video.addEventListener("ended", () => { try { localStorage.removeItem(key); } catch { /* ignore */ } });
  const close = () => { video.pause(); overlay.classList.remove("open"); window.removeEventListener("hashchange", close); setTimeout(() => overlay.remove(), 220); };
  const overlay = h("div", { class: "video-overlay", role: "dialog", "aria-label": item.title },
    h("button", { class: "close", "aria-label": "Close video", onclick: close }, icon("down", 28)), video,
    h("div", { class: "video-title" }, h("b", {}, item.title), h("span", {}, item.channel)));
  window.addEventListener("hashchange", close);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
}
