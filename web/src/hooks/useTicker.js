import { useEffect, useState } from "react";

/**
 * Epoke-ms som tikkar kvart sekund (på sekundskiftet) medan fana er synleg.
 * Berre for komponentane som treng det (live-merket og nedteljinga), så resten
 * av appen framleis teiknar på nytt berre kvart minutt (useClock).
 */
export function useTicker(intervalMs = 1000) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      timer = setTimeout(() => {
        setNowMs(Date.now());
        schedule();
      }, intervalMs - (Date.now() % intervalMs) + 20);
    };
    const wake = () => {
      setNowMs(Date.now());
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [intervalMs]);
  return nowMs;
}
