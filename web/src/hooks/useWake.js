import { useEffect, useState } from "react";

export const WAKE_DEBOUNCE_MS = 400;
export const WAKE_AFTER_BOOT_MS = 2500;

/**
 * Når sida vaknar (fana blir synleg, vindauget får fokus, sida kjem frå bfcache) eller
 * service workeren melder nye filer. Som requestWake() i vanilla-appen: samla til éin
 * vekking per 400 ms, og ingen dei fyrste 2,5 s etter opning (då hentar skalet uansett).
 *
 * Returnerer teljarar som aukar: `wake` (meldingar og sanntid på nytt), `timetable`
 * (rutetabellen på nytt) og `messages` (meldingane på nytt).
 * @param {{ enabled?: boolean, events?: EventTarget|null }} opts
 */
export function useWake({ enabled = true, events = null } = {}) {
  const [counts, setCounts] = useState({ wake: 0, timetable: 0, messages: 0 });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    const bootedAt = Date.now();
    let timer = null;
    const bump = (key) => setCounts((prev) => ({ ...prev, [key]: prev[key] + 1 }));
    const request = () => {
      if (Date.now() - bootedAt < WAKE_AFTER_BOOT_MS || timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (!document.hidden) bump("wake");
      }, WAKE_DEBOUNCE_MS);
    };
    const onVisible = () => {
      if (!document.hidden) request();
    };
    const onPageShow = (event) => {
      if (event.persisted) request();
    };
    const onTimetable = () => bump("timetable");
    const onMessages = () => bump("messages");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", request);
    events?.addEventListener("timetable-updated", onTimetable);
    events?.addEventListener("messages-updated", onMessages);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", request);
      events?.removeEventListener("timetable-updated", onTimetable);
      events?.removeEventListener("messages-updated", onMessages);
    };
  }, [enabled, events]);

  return counts;
}
