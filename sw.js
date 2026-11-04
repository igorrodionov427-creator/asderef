// Agency Pay service worker — makes the app installable and the shell load
// instantly. API calls (other origin) are never cached.
const VERSION = "ap-v1";
const SCOPE = self.registration.scope; // e.g. https://user.github.io/asderef/

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll([SCOPE, `${SCOPE}manifest.webmanifest`]).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API & 1Pay: network only
  if (url.pathname.endsWith("/config.json")) return; // always fresh

  // Hashed build assets: cache-first.
  if (url.pathname.includes("/_next/static/") || url.pathname.includes("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: network-first, fall back to cache when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(SCOPE))),
    );
  }
});
