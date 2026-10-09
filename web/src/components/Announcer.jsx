import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const AnnounceContext = createContext(() => {});

/** Dei fyrste sekunda etter lasting kjem sanntida inn for fyrste gong; det er ikkje eit skifte. */
export const SETTLE_MS = 5000;
/** Meldingar som kjem så tett, blir slått saman til éi. */
const GATHER_MS = 150;

/**
 * Den einaste aria-live-regionen for sanntid på sida (polite, atomic). Berre skifte i
 * status eller kjelde blir sagt frå, aldri posisjonsoppdateringar eller nedteljing.
 * Regionen blir tømd før kvar ny melding, så same tekst to gonger etter kvarandre
 * (t.d. «Ukjent» for to turar) blir lesen opp igjen.
 */
export function AnnouncerProvider({ children }) {
  const [message, setMessage] = useState("");
  const mounted = useRef(null);
  const pending = useRef([]);
  const timer = useRef(null);
  useEffect(() => {
    mounted.current = Date.now();
    return () => clearTimeout(timer.current);
  }, []);
  const announce = useCallback((text) => {
    if (!text || mounted.current == null || Date.now() - mounted.current < SETTLE_MS) return;
    if (!pending.current.includes(text)) pending.current.push(text);
    if (timer.current) return;
    setMessage("");
    timer.current = setTimeout(() => {
      timer.current = null;
      const all = pending.current.join(" ");
      pending.current = [];
      setMessage(all);
    }, GATHER_MS);
  }, []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className="visually-hidden" aria-live="polite" aria-atomic="true" data-announcer="">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce() {
  return useContext(AnnounceContext);
}
