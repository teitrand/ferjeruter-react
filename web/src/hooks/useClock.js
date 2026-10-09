import { useEffect, useRef, useState } from "react";

/**
 * Tikkar på kvart minuttskifte (pluss 200 ms), og når fana blir synleg att.
 * Returnerer epoke-ms. Core les sjølv klokka (Date.now), så verdien er mest ein
 * grunn til å teikne på nytt; send han vidare der ein funksjon tek `now`.
 * `wake` (frå useWake) aukar når sida vaknar via focus/pageshow; då tikkar klokka
 * med ein gong, så sanntida (useEntur) får spørje på nytt.
 */
export function useClock(wake = 0) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      timer = setTimeout(() => {
        setNowMs(Date.now());
        schedule();
      }, 60000 - (Date.now() % 60000) + 200);
    };
    const wake = () => {
      if (document.hidden) return;
      setNowMs(Date.now());
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  const lastWake = useRef(wake);
  useEffect(() => {
    if (lastWake.current === wake) return;
    lastWake.current = wake;
    setNowMs(Date.now());
  }, [wake]);
  return nowMs;
}
