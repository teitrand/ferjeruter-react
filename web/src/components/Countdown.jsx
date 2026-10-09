import { countdownParts } from "../../../packages/core/index.js";
import { useTicker } from "../hooks/useTicker.js";

/**
 * «Neste avgang om 4:05». Den synlege teksten tikkar kvart sekund utan animasjon og er
 * skjult for skjermlesar; skjermlesaren får ein tekst som berre endrar seg kvart minutt,
 * utan live-region.
 */
export function Countdown({ time, nowMs = null }) {
  const ticking = useTicker(1000);
  const parts = countdownParts(time, nowMs ?? ticking);
  return (
    <span className="countdown">
      <span className={parts.tabular ? "countdown-text is-tabular" : "countdown-text"} aria-hidden="true">
        {parts.text}
      </span>
      <span className="visually-hidden">{parts.sr}</span>
    </span>
  );
}
