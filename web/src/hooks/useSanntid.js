import { useEffect, useReducer, useRef } from "react";
import { emptySanntid, loadSanntid, sanntidDue, sanntidMode, sanntidReducer } from "../model/sanntid.js";

/**
 * Hentar AIS-posisjonen frå workeren (sjå model/sanntid.js). Svaret blir ein tilstand med siste
 * posisjon per fartøy; feil gjev backoff og endrar ikkje det vi veit. Kallbokføringa ligg i refs, så
 * ei ny teikning berre kjem når posisjonen eller feilstatusen endrar seg.
 *
 * `url` null = av. `initial` let testar og SSR gje fast tilstand; då blir det ikkje henta noko.
 * Byte av samband nullstiller posisjonane, og eit svar som kjem etter bytet blir kasta.
 */
export function useSanntid(data, ui, { url, enabled = true, initial = null } = {}) {
  const [state, dispatch] = useReducer(sanntidReducer, initial, (given) => ({ ...emptySanntid(), ...given }));
  const book = useRef({ fetchedAt: 0, generation: 0 });
  const latest = useRef({ state, data, ui });
  latest.current = { state, data, ui };
  const mounted = useRef(true);
  const active = enabled && !initial && Boolean(url);
  const ready = Boolean(data.routes || data.kombirute);
  const mode = ready ? sanntidMode(data, ui) : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Anna samband: posisjonane gjeld ikkje lenger, og vi spør med ein gong.
    book.current = { ...book.current, fetchedAt: 0, generation: book.current.generation + 1 };
  }, [mode]);

  useEffect(() => {
    if (!active || !ready) return undefined;
    const run = () => {
      const { state: current, data: d, ui: u } = latest.current;
      const at = Date.now();
      if (!sanntidDue({ fetchedAt: book.current.fetchedAt, blockedUntil: current.blockedUntil }, d, u, at, document.hidden)) return;
      book.current.fetchedAt = at;
      const generation = book.current.generation;
      loadSanntid(fetch, url).then((result) => {
        if (mounted.current && book.current.generation === generation) dispatch({ type: "loaded", result, at: Date.now() });
      });
    };
    run();
    const timer = setInterval(run, 5000);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [active, ready, url, mode]);

  return state;
}
