import { useEffect, useState } from "react";
import {
  ariaPercent,
  crossingBadge,
  crossingNote,
  crossingProgressText,
  crossingValueText,
} from "../../../packages/core/index.js";
import { usePositionState } from "../hooks/usePositionState.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";
import { t } from "./i18n.js";

/** M/F Kvernes-stil: svart skrog, kvitt overbygg (Designer, prototype.html). */
function FerryIcon() {
  return (
    <svg className="ferry" viewBox="0 0 36 18" focusable="false" aria-hidden="true">
      <rect x="10" y="3" width="16" height="7" rx="1.2" fill="var(--ferry-super)" stroke="var(--ferry-outline)" strokeWidth=".8" />
      <rect x="14" y="0.6" width="8" height="3.2" rx=".8" fill="var(--ferry-super)" stroke="var(--ferry-outline)" strokeWidth=".8" />
      <rect x="12" y="5" width="2.4" height="1.8" fill="var(--ferry-window)" />
      <rect x="16" y="5" width="2.4" height="1.8" fill="var(--ferry-window)" />
      <rect x="20" y="5" width="2.4" height="1.8" fill="var(--ferry-window)" />
      <path d="M1 10h34l-3 6.5H4z" fill="var(--ferry-hull)" stroke="var(--ferry-outline)" strokeWidth=".8" strokeLinejoin="round" />
    </svg>
  );
}

/** Kva linja og ferja skal sjå ut som: målt (heil), berekna (striper, ≈) eller ukjend (bleik, berekna). */
export function sourceAttr(view) {
  if (view.state === "calc") return "calc";
  if (view.state === "unknown") return "unknown";
  if (view.state === "outside") return "stale";
  return view.state === "stale" ? "stale" : "measured";
}

/**
 * Heil linje berre når posisjonen er målt og fersk (live). Berekna (rutetabell), siste
 * kjende og ukjend gjev stipla linje: posisjonen er ikkje eksakt.
 */
export function lineAttr(view) {
  return sourceAttr(view) === "measured" ? "solid" : "dashed";
}

/** Merket «Live · AIS · 12 s» / «Siste kjende …» / «Ukjent …» / «Berekna · rutetabell». */
export function LiveBadge({ view, reducedMotion }) {
  return (
    <span
      className="live"
      data-state={view.state}
      data-fresh={view.pulse && !reducedMotion ? "1" : undefined}
    >
      <span className="live-dot" aria-hidden="true" />
      <span className="live-label">{crossingBadge(view)}</span>
    </span>
  );
}

/**
 * Teikninga av éin overfart: éi linje mellom kaiane, med ferja på linja som einaste framdriftsvising
 * (ingen eigen framdriftsstolpe). Linja er heil når posisjonen er målt og fersk, stipla elles.
 * `view` kjem frå core crossingView. Ferja glir med éin transform (translateX), ingenting endrar layout.
 */
export function CrossingView({ view, reducedMotion = false, animate = true, showBadge = true }) {
  return (
    <div
      className={animate ? "crossing is-ready" : "crossing"}
      data-source={sourceAttr(view)}
      data-line={lineAttr(view)}
      data-motion={reducedMotion ? "reduce" : undefined}
      style={{ "--p": view.progress }}
    >
      {showBadge ? (
        <div className="crossing-head">
          {/* key: nytt element ved kvart skifte, så status-in (240 ms) køyrer. */}
          <LiveBadge key={view.state} view={view} reducedMotion={reducedMotion} />
        </div>
      ) : null}
      <div className="ferry-line-wrap">
        <div
          className="ferry-line"
          role="progressbar"
          aria-label={t("crossing.label", { from: view.from, to: view.to })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={ariaPercent(view.progress)}
          aria-valuetext={crossingValueText(view)}
        >
          <div className="line-track" />
          <span className="quay a" />
          <span className="quay b" />
          <div className="ferry-runner">
            <FerryIcon />
            <span className="ferry-approx" aria-hidden="true">≈</span>
          </div>
        </div>
      </div>
      <div className="line-labels" aria-hidden="true">
        <span>{view.from}</span>
        <span>{view.to}</span>
      </div>
      <p className="progress-meta">{crossingProgressText(view)}</p>
      <p className="source-note">{crossingNote(view)}</p>
    </div>
  );
}

/**
 * Innhaldet i «No»-raden i tidslinja: «No» og kjeldemerket på same linje, og på overfart ferjelinja
 * (kaiane på kvar si side, ferja på linja som framdrift) med framdrift, kjelde og alder under.
 * Ved kai: berre merket; raden har då den vanlege stolpen utan ferje.
 * Fyrste teikning utan overgang (ferja hoppar ikkje inn frå venstre); overgangane blir
 * slått på etter fyrste frame. Utan sanntid å vise er det berre «No».
 */
export function NowLive({ live, label, nowMs = null, children = null }) {
  const view = usePositionState(live, { nowMs });
  const reducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <>
      <div className="now-head" data-motion={reducedMotion ? "reduce" : undefined}>
        <span className="now-label">{label}</span>
        {view ? <LiveBadge key={view.state} view={view} reducedMotion={reducedMotion} /> : null}
      </div>
      {view && live?.crossing && view.state !== "outside" ? <CrossingView view={view} reducedMotion={reducedMotion} animate={ready} showBadge={false} /> : null}
      {children}
    </>
  );
}
