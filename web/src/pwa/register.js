/**
 * Service worker og installering for skalet. Berre i nettlesaren; testar og SSR får null.
 *
 * Service workeren ligg ved sida av index.html (dist/sw.js) og har scope = den mappa:
 * /ferjeruter-react/ på Pages, / på eige domene. Den gamle appen på /fergeruter/ har
 * sin eigen (sw.js der, scope /fergeruter/). Scopa overlappar ikkje, og ein service worker
 * kan ikkje få større scope enn mappa si utan Service-Worker-Allowed-hovud, så dei to
 * kan aldri styre kvarandre sine sider.
 */

/** Meldingane frå service workeren og vakne-hendingar går via eitt EventTarget. */
export function createPwaEvents() {
  return typeof EventTarget === "undefined" ? null : new EventTarget();
}

/** URL og scope for sw.js, relativt til `BASE_URL` («./», «/ferjeruter-react/» eller «/»). */
export function serviceWorkerUrls(baseUrl, href) {
  const scope = new URL(baseUrl || "./", href);
  return { url: new URL("sw.js", scope).href, scope: scope.pathname };
}

/**
 * Registrerer dist/sw.js og sender «timetable-updated» / «messages-updated» vidare
 * til `events`. Ingen service worker i vite dev (`enabled` = import.meta.env.PROD).
 */
export function registerServiceWorker(events, { enabled, baseUrl, nav = navigator, loc = location } = {}) {
  if (!enabled || !nav || !("serviceWorker" in nav)) return false;
  const { url, scope } = serviceWorkerUrls(baseUrl, loc.href);
  nav.serviceWorker.register(url, { scope }).catch((error) => console.error(error));
  nav.serviceWorker.addEventListener("message", (event) => {
    const type = event.data?.type;
    if (type === "timetable-updated" || type === "messages-updated") events?.dispatchEvent(new Event(type));
  });
  return true;
}

/**
 * Fangar beforeinstallprompt med ein gong modulen blir lasta. Hendinga kan kome før
 * React har montert, og då ville knappen aldri fått sjølve installeringa til nettlesaren.
 * @returns {{ take: () => Event|null, subscribe: (fn: (event: Event) => void) => () => void }}
 */
export function captureInstallPrompt(win) {
  let pending = null;
  const listeners = new Set();
  win?.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    pending = event;
    for (const fn of listeners) fn(event);
  });
  win?.addEventListener("appinstalled", () => {
    pending = null;
  });
  return {
    take() {
      const event = pending;
      pending = null;
      return event;
    },
    peek: () => pending,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
