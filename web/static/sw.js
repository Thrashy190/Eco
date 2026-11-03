// Keeps the app shell so it opens instantly and even offline. It never touches /rest or /api:
// audio and data always come from the server (audio needs Range requests, which a service worker
// does not handle well). Songs saved for offline live in IndexedDB, not here.
const CACHE = "eco-shell-v5";
const SHELL = [
  "/", "/style.css", "/manifest.webmanifest", "/icon.svg", "/icon-192.png",
  "/boot.js", "/js/app.js", "/js/settings.js", "/js/settings-view.js", "/js/media-view.js", "/js/api.js", "/js/components.js", "/js/downloads.js", "/js/md5.js",
  "/js/nowplaying.js", "/js/player.js", "/js/store.js", "/js/ui.js", "/js/views.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || !SHELL.includes(url.pathname)) return;
  // Network first, so updates show up at once; the saved copy is only for when there is no connection
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)));
});
