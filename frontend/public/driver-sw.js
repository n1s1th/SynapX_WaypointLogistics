// Driver service worker (scope /driver). Keeps the driver screens opening when
// the phone loses signal on the road: the pages and the build files they need.
// Trip data and queued records live on the phone in localStorage / IndexedDB
// (lib/driverCache.ts, lib/syncQueue.ts), not here. Map tiles are not kept.
//
// Same approach as public/loader-sw.js.

const VERSION = "driver-v2"; // v2: no /driver/login (drivers use the shared /login)
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;

// Every driver page except /driver/trip/[id] is static (details come from the
// query string), so they are saved up front and open offline even on the
// first trip. A trip page is saved the first time it is opened.
const SHELL_PAGES = [
  "/driver",
  "/driver/profile",
  "/driver/tomorrow",
  "/driver/trip",
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
];

async function precache() {
  const pages = await caches.open(PAGES);
  // One page failing must not stop the rest from being saved.
  const html = await Promise.all(
    SHELL_PAGES.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return "";
        await pages.put(url, response.clone());
        return await response.text();
      } catch {
        return "";
      }
    }),
  );
  const assets = [...new Set(html.join(" ").match(/\/_next\/static\/[\w\-.\/~%]+/g) || [])];
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

// Network first; offline, the saved copy. Pages match without their query
// (?stop_id=12): the page is the same, it reads the query in the browser.
async function page(request) {
  const cache = await caches.open(PAGES);
  const url = new URL(request.url);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(url.pathname, response.clone());
    return response;
  } catch (err) {
    const cached = (await cache.match(url.pathname)) || (await cache.match("/driver"));
    if (cached) return cached;
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

function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // The server API and map tiles are other origins: always the network.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  const isDriverPath = url.pathname === "/driver" || url.pathname.startsWith("/driver/");
  if (!isDriverPath) return;
  // Screen-to-screen data: offline it fails, and Next.js then loads the page
  // itself, which the page handler below serves from the saved copy.
  if (isRscRequest(request, url)) return;
  // A page load, or the app asking for a page to keep (lib/driverCache.ts keepPageOffline)
  const wantsPage = request.mode === "navigate" || (request.headers.get("Accept") || "").includes("text/html");
  if (wantsPage) event.respondWith(page(request));
});
