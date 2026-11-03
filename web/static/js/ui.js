// Small building blocks shared by every view: DOM helper, icons, toast, formatting.

/** Create an element. Props starting with "on" become listeners; null children are skipped. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
  library: '<path d="M4 5v14M9 5v14M14.5 6.5l4.5 12.5"/>',
  play: '<path class="fill" d="M7 4.6v14.8L19.6 12z"/>',
  pause: '<path class="fill" d="M6.5 4h3.8v16H6.5zM13.7 4h3.8v16h-3.8z"/>',
  next: '<path class="fill" d="M5 5.2v13.6L15 12zM17 5h2.2v14H17z"/>',
  prev: '<path class="fill" d="M19 5.2v13.6L9 12zM7 5H4.8v14H7z"/>',
  download: '<path d="M12 4v11m0 0 4.2-4.2M12 15l-4.2-4.2M5 20h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  more: '<circle class="fill" cx="5" cy="12" r="1.7"/><circle class="fill" cx="12" cy="12" r="1.7"/><circle class="fill" cx="19" cy="12" r="1.7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  offline: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v8m0 0-3-3m3 3 3-3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shuffle: '<path d="M3 5h3.3c5.2 0 5.2 14 10.4 14H21m0 0-2.8-2.8M21 19l-2.8 2.8M3 19h3.3c1.5 0 2.7-.8 3.6-2M21 5h-3.3c-1.5 0-2.7.8-3.6 2m6.9-2-2.8-2.8M21 5l-2.8 2.8"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
  queue: '<path d="M4 6h12M4 12h12M4 18h7M17 14.5v6l4.5-3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3m-8 0 1 13h10l1-13"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.4-9.7C1.4 7.5 3.4 4.8 6.4 4.8c1.9 0 3.5 1 5.6 3.1 2.1-2.1 3.7-3.1 5.6-3.1 3 0 5 2.7 3.8 6-1.9 5.1-9.4 9.7-9.4 9.7z"/>',
  "heart-fill": '<path class="fill" d="M12 20.5s-7.5-4.6-9.4-9.7C1.4 7.5 3.4 4.8 6.4 4.8c1.9 0 3.5 1 5.6 3.1 2.1-2.1 3.7-3.1 5.6-3.1 3 0 5 2.7 3.8 6-1.9 5.1-9.4 9.7-9.4 9.7z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.7a10 10 0 0 1 13 0M9 16.4a5 5 0 0 1 6 0"/><circle class="fill" cx="12" cy="20" r="1"/>',
};

/** An inline SVG icon that inherits the current text colour. */
export function icon(name, size = 22) {
  const span = document.createElement("span");
  span.className = `icon icon-${name}`;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
  return span;
}

/** A progress ring. percent < 0 spins forever (waiting); otherwise it fills. */
export function ring(percent, size = 30) {
  const r = 11, c = 2 * Math.PI * r;
  const wrap = document.createElement("span");
  wrap.className = "ring" + (percent < 0 ? " spin" : "");
  wrap.innerHTML = `<svg viewBox="0 0 28 28" width="${size}" height="${size}" aria-hidden="true"><circle class="track" cx="14" cy="14" r="${r}"/><circle class="bar" cx="14" cy="14" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${percent < 0 ? c * 0.72 : c * (1 - percent / 100)}"/></svg>`;
  return wrap;
}

let toastTimer;
/** Show a short message at the top of the screen. */
export function toast(message) {
  let el = document.getElementById("toast");
  if (!el) { el = h("div", { id: "toast", role: "status" }); document.body.append(el); }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3600);
}

export const clock = (seconds) => (Number.isFinite(seconds) && seconds >= 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "0:00");

export function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 19 ? "Good afternoon" : "Good evening";
}

/** Two letters for an avatar when there is no picture. */
export const initials = (name) => (name.match(/[\p{L}\p{N}]+/gu) ?? ["?"]).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** A stable hue from a string, so each artist keeps the same avatar colour. */
export function hue(text) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  return hash;
}

export const empty = (message) => h("p", { class: "empty" }, message);

export function section(title, content, action) {
  return h("section", { class: "block" }, h("div", { class: "block-head" }, h("h2", {}, title), action ?? null), content);
}

/** Pick the dominant colour of an image, for tinting the player. Same-origin covers only. */
export function dominantColor(img) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0, weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]), min = Math.min(data[i], data[i + 1], data[i + 2]);
      const w = 1 + (max - min) / 32; // favour saturated pixels over grey
      r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; weight += w;
    }
    return `${Math.round(r / weight)} ${Math.round(g / weight)} ${Math.round(b / weight)}`;
  } catch {
    return null;
  }
}
