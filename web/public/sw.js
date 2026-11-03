// Keeps the app shell so it opens instantly and even offline. It never touches /rest or /api:
// audio and data always come from the server (audio needs Range requests, which a service worker
// does not handle well). Songs saved for offline live in IndexedDB, not here.
// The build fills in both placeholders (see vite.config.ts).
const CACHE = "__CACHE__";
const SHELL = ["__SHELL__"];

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
  // Hashed files never change. Everything else is network first, so updates show up at once.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(event.request).then((saved) => saved ?? fetch(event.request)));
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)));
});
