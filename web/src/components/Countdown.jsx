import { countdownParts } from "../../../packages/core/index.js";
import { useTicker } from "../hooks/useTicker.js";

/**
 * Nedteljinga inne i statuslinja: «om 12 min», «om 3 t 18 min», «om under 1 min» (minutt rundt ned, ingen sekund).
 * Den synlege teksten er skjult for skjermlesar; skjermlesaren får fulle ord («om 3 timar og 18 minutt»), som berre
 * endrar seg kvart minutt, utan live-region. `dayAhead`: avgangen er i morgon (1069 går òg om natta).
 */
export function Countdown({ time, nowMs = null, dayAhead = 0 }) {
  const ticking = useTicker(1000);
  const parts = countdownParts(time, nowMs ?? ticking, { dayAhead });
  return (
    <span className="countdown">
      <span className="countdown-text" aria-hidden="true">
        {parts.phrase}
      </span>
      <span className="visually-hidden">{parts.srPhrase}</span>
    </span>
  );
}
