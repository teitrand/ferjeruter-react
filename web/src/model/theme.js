/**
 * Fargetema: «Enhet» (følg eininga, standard), «Lys» eller «Mørk».
 * Valet ligg i localStorage («system» = ingen nøkkel). Det oppløyste temaet blir sett som
 * data-theme="light|dark" på <html>; CSS (assets/styles.css + web/src/styles/theme.css) les berre dette.
 * Same logikk køyrer før fyrste teikning som eit lite innebygd skript (web/build/theme-early.js), så sida ikkje blinkar.
 */
export const THEME_KEY = "fergeruter-theme";
export const THEME_PREFS = ["system", "light", "dark"];
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Fargen i nettlesar-/statuslinja. Lys = toppfarga i lyst tema (--page), mørk = --page i mørkt tema. */
export const THEME_COLORS = { light: "#073b4c", dark: "#041c24" };

export function normalizePref(value) {
  return THEME_PREFS.includes(value) ? value : "system";
}

/** pref + om eininga ønskjer mørkt → «light» eller «dark». */
export function resolveTheme(pref, systemDark) {
  const p = normalizePref(pref);
  if (p === "light" || p === "dark") return p;
  return systemDark ? "dark" : "light";
}

function store(storage) {
  try {
    return storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  } catch {
    return null;
  }
}

export function readThemePref(storage) {
  try {
    return normalizePref(store(storage)?.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

/** «system» fjernar nøkkelen: standard er å følgje eininga. */
export function writeThemePref(pref, storage) {
  const s = store(storage);
  if (!s) return;
  try {
    const p = normalizePref(pref);
    if (p === "system") s.removeItem(THEME_KEY);
    else s.setItem(THEME_KEY, p);
  } catch {
    /* privat modus: valet gjeld berre denne økta */
  }
}

export function systemPrefersDark(win = typeof window !== "undefined" ? window : null) {
  try {
    return Boolean(win?.matchMedia?.(DARK_QUERY).matches);
  } catch {
    return false;
  }
}

/** Set data-theme, color-scheme og <meta name="theme-color">. Returnerer det oppløyste temaet. */
export function applyTheme(doc, pref, systemDark) {
  const theme = resolveTheme(pref, systemDark);
  const root = doc.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-theme-pref", normalizePref(pref));
  root.style.colorScheme = theme;
  const color = doc.querySelector('meta[name="theme-color"]');
  if (color) color.setAttribute("content", THEME_COLORS[theme]);
  const scheme = doc.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute("content", normalizePref(pref) === "system" ? "light dark" : theme);
  return theme;
}
