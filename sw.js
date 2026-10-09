const IS_DEV = self.location.pathname.includes("/dev/");
const CACHE = IS_DEV ? "fergeruter-dev-v84" : "fergeruter-v84";
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/app.js",
  "./assets/app.js?v=84",
  "./assets/i18n.js",
  "./assets/i18n.js?v=84",
  "./assets/styles.css",
  "./assets/styles.css?v=84",
  "./packages/core/index.js?v=84",
  "./packages/core/time.js?v=84",
  "./packages/core/legs.js?v=84",
  "./packages/core/live.js?v=84",
  "./packages/core/messages.js?v=84",
  "./packages/core/timetable.js?v=84",
  "./packages/core/plan.js?v=84",
  "./packages/core/signal.js?v=84",
  "./packages/core/tripstatus.js?v=84",
  "./packages/core/status.js?v=84",
  "./packages/core/entur.js?v=84",
  "./packages/core/vessel.js?v=84",
  "./packages/core/timeline.js?v=84",
  "./packages/core/detail.js?v=84",
  "./packages/core/prefs.js?v=84",
  "./packages/core/chrome.js?v=84",
  "./packages/core/track.js?v=84",
  "./packages/core/crossing.js?v=84",
  "./assets/favicon.svg",
  "./assets/icons/icon-192.png?v=2",
  "./assets/icons/icon-512.png?v=2",
  "./assets/icons/icon-maskable-192.png?v=2",
  "./assets/icons/icon-maskable-512.png?v=2",
  "./assets/icons/apple-touch-icon.png?v=2",
  "./data/ruter.json",
  "./data/kombirute.json",
  "./data/trafikkmeldinger.json",
  "./data/korrespondanse.json",
  "./data/signalturar.json",
];

function isOwnCache(key) {
  return IS_DEV ? key.startsWith("fergeruter-dev-") : /^fergeruter-v\d/.test(key);
}

/** Rutetabellar endrar seg sjeldan (ny FRAM-sesong). Ikkje vent på nett. */
function isTimetableJson(url) {
  return /\/data\/(ruter|kombirute|korrespondanse)\.json$/.test(url.pathname);
}

/** Trafikkmeldingar styrer 1136/1135/kombi og kan skifte medan sida er open. */
function isMessagesJson(url) {
  return url.pathname.endsWith("/trafikkmeldinger.json");
}

/** Signaltur-loggen blir skriven nokre gonger om dagen og skal ikkje bli liggjande gammal. */
function isSignalLogJson(url) {
  return url.pathname.endsWith("/signalturar.json");
}

/** Same cache-nøkkel for datafiler, òg når meldingar vart henta med ?t= tidlegare. */
function cacheKey(request) {
  const url = new URL(request.url);
  if (!url.pathname.includes("/data/")) return request;
  url.search = "";
  return new Request(url, { method: "GET" });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => isOwnCache(key) && key !== CACHE).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, { notifyType } = {}) {
  const cache = await caches.open(CACHE);
  const key = cacheKey(request);
  const cached = await cache.match(key);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const changed = !cached || (await responsesDiffer(cached, response));
      await cache.put(key, response.clone());
      if (notifyType && changed) notifyClients({ type: notifyType });
    }
    return response;
  } catch {
    if (cached) return cached;
    throw new Error("offline");
  }
}

async function responsesDiffer(cached, response) {
  const etagA = cached.headers.get("etag");
  const etagB = response.headers.get("etag");
  if (etagA && etagB) return etagA !== etagB;
  const [a, b] = await Promise.all([cached.clone().text(), response.clone().text()]);
  return a !== b;
}

function notifyClients(data) {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) client.postMessage(data);
    })
    .catch(() => undefined);
}

async function staleWhileRevalidate(request, { notify = false, waitUntil } = {}) {
  const cache = await caches.open(CACHE);
  const key = cacheKey(request);
  const cached = await cache.match(key);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const changed = !cached || (await responsesDiffer(cached, response));
        await cache.put(key, response.clone());
        if (notify && changed) notifyClients({ type: "timetable-updated" });
      }
      return response;
    })
    .catch(() => cached);
  if (waitUntil && cached) waitUntil(network.then(() => undefined).catch(() => undefined));
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const shell = /(?:\.html|\.css|\.js)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (isTimetableJson(url)) {
    event.respondWith(
      staleWhileRevalidate(request, {
        notify: true,
        waitUntil: (promise) => event.waitUntil(promise),
      })
    );
    return;
  }
  if (isMessagesJson(url)) {
    event.respondWith(networkFirst(request, { notifyType: "messages-updated" }));
    return;
  }
  if (isSignalLogJson(url)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (shell) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
