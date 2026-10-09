// Service worker for React-skalet. Malen blir fylt ut av scripts/build-sw.mjs etter
// `vite build` (CACHE, PRECACHE og DATA_URLS). Strategiane er dei same som i sw.js til
// vanilla-appen; skilnadene står ved kvar funksjon.
//
// Scope er mappa sw.js ligg i (t.d. /ferjeruter-react/ eller / på eige domene). Ein
// service worker får berre fetch-hendingar frå sider i sitt eige scope, så han rører
// aldri vanilla-appen på /fergeruter/. CacheStorage er felles for heile opphavet
// (teitrand.github.io), difor heiter cachane «fergeruter-web-<hash>», og vi ryddar
// berre i dei. Vanilla ryddar berre i «fergeruter-v<n>» og «fergeruter-dev-*».
const CACHE = "fergeruter-web-__VERSION__";
const PRECACHE = [];
const DATA_URLS = [];

const DATA_ORIGINS = new Set([self.location.origin, ...DATA_URLS.map((url) => new URL(url).origin)]);

function isOwnCache(key) {
  return /^fergeruter-web-(?!dev-)/.test(key);
}

/** Datafiler (data/*.json) her eller hos datakjelda (VITE_DATA_BASE), òg på eit anna opphav. */
function isDataJson(url) {
  return DATA_ORIGINS.has(url.origin) && /\/data\/[a-z_]+\.json$/.test(url.pathname);
}

/** Rutetabellar endrar seg sjeldan (ny FRAM-sesong). Ikkje vent på nett. */
function isTimetableJson(url) {
  return /\/data\/(ruter|kombirute|korrespondanse)\.json$/.test(url.pathname);
}

/** Trafikkmeldingar styrer 1136/1135/kombi og kan skifte medan sida er open. */
function isMessagesJson(url) {
  return url.pathname.endsWith("/trafikkmeldinger.json");
}

/** Vite-filer med hash i namnet endrar aldri innhald. */
function isHashedAsset(url) {
  return url.origin === self.location.origin && /\/assets\/[^/]+-[\w-]{8,}\.(?:js|css)$/.test(url.pathname);
}

/** Same cache-nøkkel for datafiler, òg når dei vart henta med ?t= tidlegare. */
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
      .then(async (cache) => {
        await cache.addAll(PRECACHE);
        // Data på førehand, men utan å stoppe installeringa om datakjelda er nede.
        await Promise.all(
          DATA_URLS.map((url) =>
            fetch(url, { mode: "cors", cache: "no-cache" })
              .then((response) => (response.ok ? cache.put(cacheKey(new Request(url)), response) : undefined))
              .catch(() => undefined)
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => isOwnCache(key) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

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

async function networkFirst(request, { notifyType, fallback } = {}) {
  const cache = await caches.open(CACHE);
  const key = cacheKey(request);
  const cached = await cache.match(key);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const changed = !cached || (await responsesDiffer(cached, response));
      await cache.put(key, response.clone());
      if (notifyType && changed && cached) notifyClients({ type: notifyType });
    }
    return response;
  } catch {
    if (cached) return cached;
    // Navigering offline med ?rute= o.l.: same skal som utan søk.
    const other = fallback ? (await cache.match(request, { ignoreSearch: true })) || (await cache.match(fallback)) : null;
    if (other) return other;
    throw new Error("offline");
  }
}

async function staleWhileRevalidate(request, { notifyType, waitUntil } = {}) {
  const cache = await caches.open(CACHE);
  const key = cacheKey(request);
  const cached = await cache.match(key);
  // Kopi til samanlikninga: `cached` går til sida, og når ho har lese han, kan han ikkje
  // klonast lenger (då ville oppdateringa stoppa i stillheit).
  const previous = cached ? cached.clone() : null;
  // Datafiler: spør tenaren (ETag/304), så HTTP-cachen ikkje gjev den same gamle fila.
  const network = fetch(request, key === request ? undefined : { cache: "no-cache" })
    .then(async (response) => {
      if (response.ok) {
        const changed = !previous || (await responsesDiffer(previous, response));
        await cache.put(key, response.clone());
        if (notifyType && changed && cached) notifyClients({ type: notifyType });
      }
      return response;
    })
    .catch(() => cached);
  if (waitUntil && cached) waitUntil(network.then(() => undefined).catch(() => undefined));
  return cached || network;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isDataJson(url)) {
    if (isTimetableJson(url)) {
      event.respondWith(
        staleWhileRevalidate(request, { notifyType: "timetable-updated", waitUntil: (p) => event.waitUntil(p) })
      );
    } else if (isMessagesJson(url)) {
      event.respondWith(networkFirst(request, { notifyType: "messages-updated" }));
    } else {
      // Signallogg o.l.: nett først, cache når vi er offline.
      event.respondWith(networkFirst(request));
    }
    return;
  }
  // Alt anna frå andre opphav (Entur, Fjord1, Plausible, fontar) går rett til nettet.
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, { fallback: "./" }));
    return;
  }
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (/(?:\.html|\.webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/")) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
