import { useEffect, useRef, useState } from "react";
import { SIGNAL_LOG_POLL_MS, nextSignalLog } from "../model/signallog.js";

/**
 * Held signalloggen fersk medan sida står open. `urls` er kjeldene (signalLogUrls: workeren frå heimeserveren og
 * fila på Pages); alle blir henta med ein gong sida er klar, kvart 5. minutt (berre når fana er synleg) og når sida
 * vaknar (`refresh` aukar). Den nyaste loggen vinn. Feil, 404 og eldre svar lèt den noverande loggen stå.
 * `loaded` er loggen useAppData fann ved oppstart. `live` = false i testar og SSR.
 */
export function useSignalLog(urls, loaded, { live = true, ready = true, refresh: refreshKey = 0 } = {}) {
  const [fetched, setFetched] = useState(null);
  const kick = useRef(null);
  const urlsKey = urls.join("|");

  useEffect(() => {
    if (!live || !ready) return undefined;
    let alive = true;
    let timer = null;
    const fetchOne = async (url) => {
      try {
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) return;
        const json = await response.json();
        if (alive) setFetched((previous) => nextSignalLog(previous, json));
      } catch {
        // Ei kjelde kan mangle ei stund; den gamle loggen blir ståande.
      }
    };
    const fetchAll = () => Promise.all(urlsKey.split("|").map(fetchOne));
    const poll = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!document.hidden) await fetchAll();
        if (alive) poll();
      }, SIGNAL_LOG_POLL_MS);
    };
    kick.current = () => {
      if (document.hidden) return;
      fetchAll();
      poll();
    };
    // Med ein gong: workeren kan ha ein nyare logg enn fila useAppData fann. Så kvart 5. minutt.
    fetchAll();
    poll();
    return () => {
      alive = false;
      kick.current = null;
      clearTimeout(timer);
    };
  }, [urlsKey, live, ready]);

  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (lastKey.current === refreshKey) return;
    lastKey.current = refreshKey;
    kick.current?.();
  }, [refreshKey]);

  return nextSignalLog(loaded, fetched);
}
