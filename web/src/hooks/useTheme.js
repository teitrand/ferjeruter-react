import { useCallback, useEffect, useState } from "react";
import {
  DARK_QUERY,
  THEME_KEY,
  applyTheme,
  readThemePref,
  resolveTheme,
  systemPrefersDark,
  writeThemePref,
} from "../model/theme.js";

/**
 * Fargetema: standard er å følgje eininga (live: endrar seg når eininga byter), elles det lagra valet.
 * Skriptet i <head> har alt sett data-theme før React starta; dette held det i synk og tek imot endringar.
 */
export function useTheme() {
  const [pref, setPrefState] = useState(() => readThemePref());
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());

  useEffect(() => {
    const media = window.matchMedia?.(DARK_QUERY);
    if (!media) return undefined;
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  // Anna fane endrar valet: følg med.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === THEME_KEY || e.key === null) setPrefState(readThemePref());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    applyTheme(document, pref, systemDark);
  }, [pref, systemDark]);

  const setPref = useCallback((next) => {
    writeThemePref(next);
    setPrefState(next);
  }, []);

  return { pref, theme: resolveTheme(pref, systemDark), setPref };
}
