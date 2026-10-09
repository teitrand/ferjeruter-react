import { useEffect, useRef, useState } from "react";
import { emptyData } from "../model/context.js";
import { fetchAppData, mergeLoaded } from "../model/data.js";

/**
 * Lastar data/*.json, som loadRoutes() i vanilla-appen:
 * - Ligg rutetabellen i `cache` (localStorage), blir han vist med ein gong ("ready").
 * - Så blir filene henta. Er rutetabellen den same (timetableFingerprint), blir dei
 *   gamle objekta ståande og ingenting blir teikna på nytt (mergeLoaded).
 * - Feilar hentinga med cache, held skalet fram med cachen (offline). Utan cache: "error".
 * - Når `reload` aukar (service workeren melder ny rutetabell), blir filene henta på nytt.
 *
 * `initial` let testar og SSR gje fast data utan nett og utan cache.
 * @returns {{ data: import("../model/context.js").AppData, status: "loading"|"ready"|"error" }}
 */
export function useAppData(base, initial = null, liveBase = base, { cache = null, reload = 0 } = {}) {
  const [state, setState] = useState(() => {
    if (initial) return { data: { ...emptyData(), ...initial }, status: "ready" };
    const cached = cache?.read();
    return cached ? { data: { ...emptyData(), ...cached }, status: "ready" } : { data: emptyData(), status: "loading" };
  });
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (initial) return undefined;
    let cancelled = false;
    fetchAppData(fetch, base, liveBase)
      .then((loaded) => {
        if (cancelled) return;
        const { data, timetableChanged } = mergeLoaded(latest.current.data, loaded);
        if (timetableChanged) cache?.write(data);
        setState((prev) => (prev.data === data && prev.status === "ready" ? prev : { data, status: "ready" }));
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setState((prev) => (prev.status === "ready" ? prev : { ...prev, status: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, [base, initial, liveBase, cache, reload]);
  return state;
}
