import { useEffect, useState } from "react";

/** navigator.onLine, eller true når vi ikkje veit (SSR, testar). */
export function isOnline(nav = typeof navigator !== "undefined" ? navigator : null) {
  return nav?.onLine !== false;
}

/**
 * Om nettlesaren meiner han er på nett. Endrar seg med «online»/«offline», så fotnoten
 * seier «Fekk ikkje kontakt med Entur» med ein gong nettet fell, ikkje fyrst ved neste kall.
 */
export function useOnline(target = typeof window !== "undefined" ? window : null) {
  const [online, setOnline] = useState(() => isOnline());
  useEffect(() => {
    if (!target) return undefined;
    const update = () => setOnline(isOnline());
    target.addEventListener("online", update);
    target.addEventListener("offline", update);
    update();
    return () => {
      target.removeEventListener("online", update);
      target.removeEventListener("offline", update);
    };
  }, [target]);
  return online;
}
