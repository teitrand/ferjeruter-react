/**
 * Anonym bruksstatistikk (Plausible) og kva slags app sida køyrer som, felles for
 * vanilla og React. Ingen av funksjonane kastar: statistikk skal ikkje stoppe sida.
 */
export const PWA_FIRST_KEY = "fergeruter-pwa-first-open";

/** «pwa» når sida er opna som installert app, elles «web». */
export function appMode(win = typeof window !== "undefined" ? window : null, nav = win?.navigator) {
  try {
    if (!win) return "web";
    if (win.matchMedia?.("(display-mode: standalone)").matches) return "pwa";
    if (nav?.standalone) return "pwa";
  } catch {
    // matchMedia kan mangle
  }
  return "web";
}

/** Kva install-rettleiing som passar best. iOS har ikkje beforeinstallprompt. */
export function installHint(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return "desktop";
  const ua = nav.userAgent || "";
  const platform = nav.platform || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1);
  if (ios) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

/** Fyrste gong sida er open som installert app, per nettlesar. */
export function markPwaFirstOpen(storage, mode) {
  if (mode !== "pwa") return false;
  try {
    if (!storage || storage.getItem(PWA_FIRST_KEY)) return false;
    storage.setItem(PWA_FIRST_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function plausibleRoute(choice) {
  if (choice === "1135") return "saebo-leknes";
  if (choice === "1049") return "festoya-hundeidvik";
  return "standal-trandal";
}

/** Eigenskapane kvar hending får: språk, web/pwa og valt samband. */
export function plausibleContext({ lang, app, route }, extra) {
  return { lang, app, route: plausibleRoute(route), ...extra };
}

/**
 * Sender éi hending til window.plausible om skriptet er lasta.
 * `context` = { lang, app, route } der route er valt samband («1136»/«1135»/«1049»).
 */
export function trackEvent(win, name, props, context, { interactive = true } = {}) {
  try {
    const fn = win ? win.plausible : null;
    if (typeof fn !== "function") return;
    const payload = { props: plausibleContext(context, props) };
    if (!interactive) payload.interactive = false;
    fn(name, payload);
  } catch {
    // statistikk skal ikkje stoppe sida
  }
}
