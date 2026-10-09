import { useEffect, useReducer, useRef } from "react";
import { emptySanntid, loadSanntid, sanntidDue, sanntidMode, sanntidReducer } from "../model/sanntid.js";
import { readSanntidCache, writeSanntidCache } from "../model/sanntidCache.js";
import { takeEarlySanntid } from "../model/sanntidEarly.js";

/**
 * Hentar AIS-posisjonen frå workeren (sjå model/sanntid.js). Svaret blir ein tilstand med siste
 * posisjon per fartøy; feil gjev backoff og endrar ikkje det vi veit. Kallbokføringa ligg i refs, så
 * ei ny teikning berre kjem når posisjonen eller feilstatusen endrar seg.
 *
 * Fort ved opning:
 *  - Fyrste kall startar utan å vente på rutetabellen (og brukar den tidlege hentinga frå index.html når ho finst).
 *  - Sist kjende posisjon frå førre økt (localStorage) ligg i tilstanden frå fyrste teikning, med den verkelege alderen.
 *  - Nytt kall når fana blir synleg, fokusert eller nettet kjem tilbake (framleis med 15/60 s mellom kall).
 *
 * `url` null = av. `initial` let testar og SSR gje fast tilstand; då blir det ikkje henta noko.
 * `cache` null = ingen lagring (testar). Eit svar som kjem etter bytet av samband blir kasta.
 */
export function useSanntid(data, ui, { url, enabled = true, initial = null, cache = globalThis.localStorage } = {}) {
  const [state, dispatch] = useReducer(sanntidReducer, initial, (given) => {
    const cached = !given && cache ? readSanntidCache(cache) : [];
    return { ...emptySanntid(), ...(cached.length ? { entries: cached } : {}), ...(given ? { loaded: true } : {}), ...given };
  });
  const book = useRef({ fetchedAt: 0, generation: 0 });
  const latest = useRef({ state, data, ui });
  latest.current = { state, data, ui };
  const mounted = useRef(true);
  const active = enabled && !initial && Boolean(url);
  const ready = Boolean(data.routes || data.kombirute);
  const mode = ready ? sanntidMode(data, ui) : null;
  const previousMode = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Anna samband: posisjonane gjeld ikkje lenger, og vi spør med ein gong. Ikkje når rutetabellen berre kjem inn
    // (null → samband): svaret har alle linjene, så det fyrste kallet er allereie på veg.
    if (previousMode.current != null && mode !== previousMode.current) {
      book.current = { ...book.current, fetchedAt: 0, generation: book.current.generation + 1 };
    }
    previousMode.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!cache || !state.loaded || initial) return;
    writeSanntidCache(state.entries, cache);
  }, [state.entries, state.loaded, cache, initial]);

  useEffect(() => {
    if (!active) return undefined;
    const run = () => {
      const { state: current, data: d, ui: u } = latest.current;
      const at = Date.now();
      if (!sanntidDue({ fetchedAt: book.current.fetchedAt, blockedUntil: current.blockedUntil }, d, u, at, document.hidden)) return;
      book.current.fetchedAt = at;
      const generation = book.current.generation;
      const early = book.current.usedEarly ? null : takeEarlySanntid(url);
      book.current.usedEarly = true;
      loadSanntid(fetch, url, { early }).then((result) => {
        if (mounted.current && book.current.generation === generation) dispatch({ type: "loaded", result, at: Date.now() });
      });
    };
    run();
    const timer = setInterval(run, 5000);
    const events = ["visibilitychange", "focus", "online", "pageshow"];
    for (const name of events) (name === "focus" || name === "online" || name === "pageshow" ? window : document).addEventListener(name, run);
    return () => {
      clearInterval(timer);
      for (const name of events) (name === "focus" || name === "online" || name === "pageshow" ? window : document).removeEventListener(name, run);
    };
  }, [active, url]);

  return state;
}
