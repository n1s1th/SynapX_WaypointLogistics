// Driver service worker (scope /driver). Keeps the driver app shell usable
// when the phone loses signal, so a reload or a reopened browser still opens
// the trip. Trip data, delivery records and photos live in IndexedDB
// (lib/syncQueue.ts), not here. API calls are never cached.
//
// Same structure as public/loader-sw.js.

const VERSION = "driver-v1";
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;

// Screens a driver needs mid-route. Query strings (?stop_id=) are ignored when
// matching, the pages read them client-side.
const SHELL_PAGES = [
  "/driver",
  "/driver/login",
  "/driver/trip",
  "/driver/trip/arrived",
  "/driver/trip/outcome",
  "/driver/trip/proof",
  "/driver/queue",
  "/driver/queue/sync",
  "/driver/queue/conflict",
  "/driver/report",
];

async function precache() {
  const pages = await caches.open(PAGES);
  await Promise.all(SHELL_PAGES.map((url) => pages.add(url).catch(() => undefined)));
  const html = (
    await Promise.all(SHELL_PAGES.map(async (url) => (await pages.match(url))?.text() ?? ""))
  ).join(" ");
  const assets = [...new Set(html.match(/\/_next\/static\/[\w\-.\/~%]+/g) || [])];
  const statics = await caches.open(STATIC);
  await Promise.all(assets.map((url) => statics.add(url).catch(() => undefined)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("driver-") && !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Network first; on failure use the cached copy. A page never visited falls
// back to the Offline Queue, which lists the cached trips.
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw err;
  }
}

// Build output under /_next/static is content-hashed, so cache first is safe.
async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the API is another origin: always network
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  const isDriverPath = url.pathname === "/driver" || url.pathname.startsWith("/driver/");
  if (request.mode === "navigate" && isDriverPath) {
    event.respondWith(networkFirst(request, "/driver/queue"));
    return;
  }
  // Client-side navigation data (RSC payloads)
  if (isDriverPath) {
    event.respondWith(networkFirst(request));
  }
});
