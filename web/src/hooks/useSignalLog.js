import { useEffect, useRef, useState } from "react";
import { DATA_FILES } from "../model/data.js";
import { SIGNAL_LOG_POLL_MS, nextSignalLog } from "../model/signallog.js";

/**
 * Held signalloggen fersk medan sida står open: hentar fila på nytt kvart 5. minutt (berre når fana er synleg)
 * og med ein gong sida vaknar (`refresh` aukar). Feil og eldre svar lèt den noverande loggen stå.
 * `loaded` er loggen useAppData fann ved oppstart. `live` = false i testar og SSR.
 */
export function useSignalLog(base, loaded, { live = true, ready = true, refresh: refreshKey = 0 } = {}) {
  const [fetched, setFetched] = useState(null);
  const kick = useRef(null);

  useEffect(() => {
    if (!live || !ready) return undefined;
    let alive = true;
    let timer = null;
    const fetchFile = async () => {
      try {
        const response = await fetch(base + DATA_FILES.signalLog, { cache: "no-cache" });
        if (!response.ok) return;
        const json = await response.json();
        if (alive) setFetched((previous) => nextSignalLog(previous, json));
      } catch {
        // Loggen kan mangle ei stund; den gamle blir ståande.
      }
    };
    const poll = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!document.hidden) await fetchFile();
        if (alive) poll();
      }, SIGNAL_LOG_POLL_MS);
    };
    kick.current = () => {
      if (document.hidden) return;
      fetchFile();
      poll();
    };
    poll();
    return () => {
      alive = false;
      kick.current = null;
      clearTimeout(timer);
    };
  }, [base, live, ready]);

  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (lastKey.current === refreshKey) return;
    lastKey.current = refreshKey;
    kick.current?.();
  }, [refreshKey]);

  return nextSignalLog(loaded, fetched);
}
