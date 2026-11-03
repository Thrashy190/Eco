// The mini player above the tab bar and the full-screen player that opens from it.
import { h, icon, clock, dominantColor } from "./ui.js";
import { songCover, hasCover } from "./api.js";
import * as player from "./player.js";
import * as offline from "./store.js";
import * as settings from "./settings.js";
import { saveOffline, removeOffline, songMenu, toggleFavorite, go } from "./components.js";

const playIcon = () => icon(player.isPlaying() ? "pause" : "play", 24);

export function mount(host) {
  // ---- mini player ----
  const miniCover = h("img", { class: "cover", alt: "" });
  const miniTitle = h("b", {});
  const miniArtist = h("span", {});
  const miniPlay = h("button", { class: "icon-button", "aria-label": "Play or pause", onclick: (e) => { e.stopPropagation(); player.toggle(); } });
  const miniNext = h("button", { class: "icon-button", "aria-label": "Next", onclick: (e) => { e.stopPropagation(); player.next(); } }, icon("next", 22));
  const hairline = h("i", { class: "hairline" });
  const mini = h("div", { class: "mini", hidden: true, onclick: () => open() }, miniCover, h("div", { class: "text" }, miniTitle, miniArtist), miniPlay, miniNext, hairline);

  // ---- full player ----
  const art = h("img", { class: "art", alt: "" });
  const title = h("h2", {});
  const artist = h("a", { class: "artist-link" });
  const seek = h("input", { type: "range", min: "0", max: "1000", value: "0", "aria-label": "Position" });
  const elapsed = h("span", {}, "0:00"), total = h("span", {}, "0:00");
  const play = h("button", { class: "main-play", "aria-label": "Play or pause", onclick: player.toggle });
  const shuffle = h("button", { class: "ghost", "aria-label": "Shuffle", onclick: player.toggleShuffle }, icon("shuffle", 22));
  const repeat = h("button", { class: "ghost", "aria-label": "Repeat", onclick: player.cycleRepeat }, icon("repeat", 22));
  const saveBtn = h("button", { class: "ghost wide", onclick: () => { const s = player.current(); if (s) (offline.isSaved(s.id) ? removeOffline(s) : saveOffline(s)); } });
  const heart = h("button", { class: "ghost heart", "aria-label": "Favorite", onclick: () => { const s = player.current(); if (s) toggleFavorite(s); } });
  const speedBtn = h("button", { class: "ghost wide", hidden: true, "aria-label": "Playback speed", onclick: player.cycleSpeed });
  const moreBtn = h("button", { class: "ghost wide", onclick: () => { const s = player.current(); if (s) songMenu(s); } }, icon("more", 20), "More");
  const queueList = h("ul", { class: "rows queue" });
  const sheet = h("section", { class: "now", hidden: true, role: "dialog", "aria-label": "Now playing" },
    h("button", { class: "close", "aria-label": "Minimise", onclick: () => close() }, icon("down", 28)),
    art, h("div", { class: "titles" }, title, artist),
    h("div", { class: "seek" }, seek, h("div", { class: "times" }, elapsed, total)),
    h("div", { class: "transport" }, shuffle, h("button", { class: "ghost", "aria-label": "Previous", onclick: player.previous }, icon("prev", 30)), play,
      h("button", { class: "ghost", "aria-label": "Next", onclick: () => player.next() }, icon("next", 30)), repeat),
    h("div", { class: "extras" }, heart, speedBtn, saveBtn, moreBtn),
    h("h3", {}, "Up next"), queueList);
  host.append(mini, sheet);

  const NEUTRAL = "60 60 70";
  let dragging = false, shownCover = null, shownTrack = null, tint = NEUTRAL;
  const applyTint = () => sheet.style.setProperty("--tint", settings.get().tint ? tint : NEUTRAL);
  settings.onChange(applyTint);
  const open = () => { sheet.hidden = false; requestAnimationFrame(() => sheet.classList.add("open")); };
  const close = () => { sheet.classList.remove("open"); setTimeout(() => { sheet.hidden = true; }, 220); };
  // Any navigation (Go to artist, Go to album, a link) means the player must get out of the way
  window.addEventListener("hashchange", () => { if (!sheet.hidden) close(); });

  seek.addEventListener("input", () => { dragging = true; elapsed.textContent = clock((seek.value / 1000) * player.length()); });
  seek.addEventListener("change", () => { player.seek((seek.value / 1000) * player.length()); dragging = false; });
  artist.addEventListener("click", (e) => { const s = player.current(); if (s?.artistId) { e.preventDefault(); close(); go(`#/artist/${s.artistId}`); } });

  function render() {
    const song = player.current();
    mini.hidden = !song;
    document.body.classList.toggle("has-player", Boolean(song));
    if (!song) return;
    const { shuffle: shuffled, repeat: repeating } = player.state();
    miniTitle.textContent = title.textContent = song.title;
    miniArtist.textContent = artist.textContent = song.artist;
    artist.href = song.artistId ? `#/artist/${song.artistId}` : "#";
    miniPlay.replaceChildren(playIcon());
    play.replaceChildren(playIcon());
    shuffle.classList.toggle("on", shuffled);
    repeat.classList.toggle("on", repeating !== "off");
    repeat.dataset.mode = repeating;
    const spoken = player.isSpoken(song);
    speedBtn.hidden = !spoken;
    speedBtn.textContent = `${player.speed()}×`;
    heart.hidden = spoken; // favourites are Navidrome's: they only exist for music
    heart.replaceChildren(icon(song.starred ? "heart-fill" : "heart", 22));
    heart.classList.toggle("on", Boolean(song.starred));
    saveBtn.replaceChildren(icon(offline.isSaved(song.id) ? "check" : "offline", 20), offline.isSaved(song.id) ? "Saved offline" : "Save offline");

    if (shownTrack !== song.id) {
      shownTrack = song.id;
      const src = hasCover(song) ? songCover(song, 600) : "";
      if (src !== shownCover) {
        shownCover = src;
        art.src = miniCover.src = src;
        art.classList.toggle("empty", !src);
        art.classList.remove("swap"); void art.offsetWidth; art.classList.add("swap"); // replay the entrance
        const probe = new Image();
        probe.onload = () => { tint = dominantColor(probe) ?? NEUTRAL; applyTint(); };
        probe.src = src;
        if (!src) { tint = NEUTRAL; applyTint(); }
      }
    }
    const next = player.upcoming();
    queueList.replaceChildren(...next.slice(0, 50).map((s, k) => h("li", { class: "row", onclick: () => player.jumpTo(player.indexOfCurrent() + 1 + k) },
      h("div", { class: "text" }, h("b", {}, s.title), h("span", {}, s.artist)), h("span", { class: "time" }, s.duration ? clock(s.duration) : ""))));
    if (!next.length) queueList.replaceChildren(h("li", { class: "empty" }, "The queue is empty"));
  }

  player.onChange(render);
  offline.onChange(render);
  document.addEventListener("eco:favorite", render);
  player.onTime((position, length) => {
    elapsed.textContent = dragging ? elapsed.textContent : clock(position);
    total.textContent = clock(length);
    if (!dragging && length) seek.value = Math.round((position / length) * 1000);
    hairline.style.transform = `scaleX(${length ? Math.min(position / length, 1) : 0})`;
  });
  render();
}
