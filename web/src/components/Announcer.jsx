import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const AnnounceContext = createContext(() => {});

/** Dei fyrste sekunda etter lasting kjem sanntida inn for fyrste gong; det er ikkje eit skifte. */
export const SETTLE_MS = 5000;

/**
 * Den einaste aria-live-regionen for sanntid på sida (polite, atomic). Berre skifte i
 * status eller kjelde blir sagt frå, aldri posisjonsoppdateringar eller nedteljing.
 */
export function AnnouncerProvider({ children }) {
  const [message, setMessage] = useState("");
  const mounted = useRef(null);
  useEffect(() => {
    mounted.current = Date.now();
  }, []);
  const announce = useCallback((text) => {
    if (!text || mounted.current == null || Date.now() - mounted.current < SETTLE_MS) return;
    setMessage(text);
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
