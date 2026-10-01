// Driver service worker (scope /driver). Keeps the driver app usable when the
// phone loses coverage on the road: the app shell, the build assets it needs,
// and the map tiles the driver has already looked at. Trip data and queued
// records live in IndexedDB (lib/driver/offline), not here.
//
// Same approach as public/loader-sw.js.

const VERSION = "driver-v1";
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;
const TILES = `${VERSION}-tiles`;

// Every driver page is static (details come from the query string), so all of
// them can be cached up front and open offline even on the first trip.
const SHELL_PAGES = [
  "/driver",
  "/driver/login",
  "/driver/profile",
  "/driver/trip",
  "/driver/trip/overview",
  "/driver/trip/arrived",
  "/driver/trip/outcome",
  "/driver/trip/proof",
  "/driver/trip/complete",
  "/driver/trip/summary",
  "/driver/trip/depot",
  "/driver/report",
  "/driver/sos",
  "/driver/sos/success",
  "/driver/queue",
  "/driver/queue/sync",
  "/driver/queue/conflict",
];
const PRECACHE = [...SHELL_PAGES, "/driver.webmanifest", "/icons/icon-192.svg", "/icons/icon-512.svg"];

// Map tiles the driver has viewed (no bulk download, per the OpenStreetMap
// tile usage policy). Oldest dropped beyond this many.
const TILE_HOST = "tile.openstreetmap.org";
const MAX_TILES = 600;

async function precache() {
  const pages = await caches.open(PAGES);
  await pages.addAll(PRECACHE);
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

// Network first; offline, the cached copy. Pages match without their query
// (?trip=12&stop=34): the page is the same, it reads the query in the browser.
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
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

async function trimTiles(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i += 1) await cache.delete(keys[i]);
}

// Tiles: cached copy first (they rarely change), else the network, kept for later.
async function tile(request) {
  const cache = await caches.open(TILES);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Cross-origin images come back opaque; they can still be cached and drawn.
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
    trimTiles(cache);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname.endsWith(TILE_HOST)) {
    event.respondWith(tile(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // API calls always go to the network; the app keeps its own copy in IndexedDB.
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  const isDriverPath = url.pathname === "/driver" || url.pathname.startsWith("/driver/");
  if (request.mode === "navigate" && isDriverPath) {
    event.respondWith(networkFirst(request, "/driver"));
    return;
  }
  // Client-side navigation data (RSC payloads) and the manifest.
  if (isDriverPath || url.pathname === "/driver.webmanifest") {
    event.respondWith(networkFirst(request));
  }
});
