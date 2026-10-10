import { useEffect, useMemo, useRef } from "react";
import { crossingAnnouncement, crossingView, positionSourceView } from "../../../packages/core/index.js";
import { useAnnounce } from "../components/Announcer.jsx";
import { useTicker } from "./useTicker.js";

/**
 * Sanntida under statuslinja, rekna ut på nytt kvart sekund (alder på posisjonen,
 * Live → Siste kjende → Ukjent). På overfart: core crossingView med framdrift; elles
 * core positionSourceView (berre kjeldemerket).
 *
 * `previous` ligg i ein ref per montert komponent: framdrifta går aldri bakover for same
 * tur så lenge komponenten lever, og golvet forsvinn når han blir avmontert (ny lasting,
 * anna rute, eller når overfarten er over).
 *
 * Live-regionen seier frå berre ved dei skifta core crossingAnnouncement godtek.
 * @param {{ crossing: { leg: object, fixes: object[] }|null, fixes: object[] }} live
 */
export function usePositionState(live, { nowMs: fixedNow = null, announce: speak = true } = {}) {
  const ticking = useTicker(1000);
  const nowMs = fixedNow ?? ticking;
  const previous = useRef(null);
  const crossing = live?.crossing || null;
  const fixes = live?.fixes || [];
  const view = useMemo(
    () =>
      crossing
        ? crossingView({ leg: crossing.leg, fixes: crossing.fixes, nowMs, previous: previous.current, allowOutside: !crossing.multi })
        : positionSourceView(fixes, nowMs, previous.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [crossing?.leg, crossing?.fixes, fixes, nowMs]
  );
  const announce = useAnnounce();
  useEffect(() => {
    const message = crossingAnnouncement(previous.current, view);
    if (message && speak) announce(message);
    previous.current = view;
  }, [view, announce]);
  return view;
}
