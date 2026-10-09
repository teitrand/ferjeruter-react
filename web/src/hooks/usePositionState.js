import { useEffect, useMemo, useRef } from "react";
import { crossingAnnouncement, crossingView } from "../../../packages/core/index.js";
import { useAnnounce } from "../components/Announcer.jsx";
import { useTicker } from "./useTicker.js";

/**
 * Overfarten no, rekna ut på nytt kvart sekund (alder på posisjonen, Live → Siste kjende).
 * Framdrifta går aldri bakover for same tur (core crossingView med førre resultat).
 * Når tilstanden eller kjelda skifter, seier den felles live-regionen frå. Aldri ved
 * vanlege posisjonsoppdateringar.
 * @param {{ leg: object, fixes: object[] }} crossing
 */
export function usePositionState(crossing, { nowMs: fixedNow = null } = {}) {
  const ticking = useTicker(1000);
  const nowMs = fixedNow ?? ticking;
  const previous = useRef(null);
  const view = useMemo(
    () => crossingView({ leg: crossing.leg, fixes: crossing.fixes, nowMs, previous: previous.current }),
    [crossing.leg, crossing.fixes, nowMs]
  );
  const announce = useAnnounce();
  useEffect(() => {
    const message = crossingAnnouncement(previous.current, view);
    if (message) announce(message);
    previous.current = view;
  }, [view, announce]);
  return view;
}
