// Ultimyr service worker. Deliberately small: it makes the app installable and keeps the static shell fast.
// It never touches API calls, sign in, OAuth or MCP, and never stores anything personal.
const VERSION = "v2";
const PAGES = "ultimyr-pages-v2";
const STATIC = `ultimyr-static-${VERSION}`;
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => (k.startsWith("ultimyr-static-") && k !== STATIC) || (k.startsWith("ultimyr-pages-") && k !== PAGES)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Hashed build assets never change: serve from cache, fill it on first use.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Pages: always the network first. Course and item pages are an empty shell (the person's data arrives later from the
  // API, which is never cached), so the last copy of the shell is kept to open them offline; it is removed on sign out.
  if (req.mode === "navigate") {
    const keep = url.pathname.startsWith("/archives/") || url.pathname.startsWith("/items/");
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (keep && res.ok) caches.open(PAGES).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(async () => (keep ? await caches.open(PAGES).then((c) => c.match(req)) : undefined) || caches.match(OFFLINE)),
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear-pages") event.waitUntil(caches.delete(PAGES));
});
