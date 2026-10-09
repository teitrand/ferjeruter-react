import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** true når brukaren har bede om mindre rørsle. CSS stoppar òg rørsla; dette tek pulsen bort i DOM. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(QUERY).matches)
  );
  useEffect(() => {
    const media = window.matchMedia?.(QUERY);
    if (!media) return undefined;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
