import { useEffect, useState } from "react";
import { usePositionState } from "../hooks/usePositionState.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";
import { composeNowCard } from "../model/nowcard.js";
import { FerryV2 } from "./FerryV2.jsx";

/** Klokkeslett og tal står i feit skrift (som i skissene). */
function Bold({ text }) {
  return String(text)
    .split(/(\d{1,2}:\d{2}|\d+ (?:knop|knots|Knoten))/)
    .map((part, index) => (index % 2 ? <b key={index}>{part}</b> : part));
}

function Pier({ side }) {
  return (
    <svg className={`na-pier na-pier-${side}`} viewBox="0 0 20 28" focusable="false" aria-hidden="true">
      <path className="na-pier-deck" d="M2 8h16v3H2z" />
      <path className="na-pier-post" d="M4 11v14M10 11v14M16 11v14" />
      <path className="na-pier-top" d="M1 8l3-4h12l3 4" />
    </svg>
  );
}

export function BadgeIcon({ icon }) {
  const common = { viewBox: "0 0 16 16", className: "na-badge-icon", focusable: "false", "aria-hidden": "true" };
  if (icon === "live")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="2" fill="currentColor" />
        <path d="M4.2 4.2a5.4 5.4 0 0 0 0 7.6M11.8 4.2a5.4 5.4 0 0 1 0 7.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  if (icon === "clock")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.6V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  if (icon === "calc")
    return (
      <svg {...common}>
        <path d="M2 6.2q1.5-1.6 3-.0t3 0 3 0 3 0M2 10.4q1.5-1.6 3 0t3 0 3 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.4" />
    </svg>
  );
}

/** Blå stipla pil: ferja er utanfor ruta, ingen line mellom kaiane og ingen kai å peike på. */
function OutsideArrow() {
  return (
    <svg className="na-arrow" viewBox="0 0 120 12" focusable="false" aria-hidden="true">
      <path d="M2 6h100" fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray="7 5" strokeLinecap="round" />
      <path d="M100 1.5L113 6l-13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Scene({ scene, reducedMotion, ready }) {
  if (scene.kind === "outside") {
    return (
      <div className="na-scene na-scene-outside" aria-hidden="true">
        <span className="na-ferry na-ferry-static">
          <FerryV2 />
        </span>
        <OutsideArrow />
      </div>
    );
  }
  const className = [
    "na-scene",
    `na-fill-${scene.fill}`,
    scene.dashed ? "is-dashed" : "is-solid",
    scene.faded ? "is-faded" : "",
    scene.moving ? "is-moving" : "",
    scene.to ? "" : "is-single",
    ready ? "is-ready" : "",
    reducedMotion ? "is-reduced" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className} style={{ "--x": scene.x }} aria-hidden="true">
      <div className="na-rail">
        <Pier side="a" />
        <div className="na-track">
          <span className="na-bar">
            <span className="na-lane na-lane-bar">
              <span className="na-fill" />
            </span>
          </span>
          <span className="na-runner">
            <span className="na-ferry">
              {scene.moving ? <span className="na-wake" /> : null}
              {scene.marker ? <span className="na-marker">{scene.marker}</span> : null}
              <FerryV2 />
            </span>
          </span>
        </div>
        {scene.to ? <Pier side="b" /> : null}
      </div>
      <div className="na-quays">
        <span>{scene.from}</span>
        {scene.to ? <span>{scene.to}</span> : null}
      </div>
    </div>
  );
}

/**
 * «No»-kortet over tidslinja (Designer V2): hovudlinje, støttelinje, ferja på linja og kjeldemerket nederst.
 * Heile det synlege kortet er aria-hidden; skjermlesar får éi setning (role=status, aria-label «Ferja no»).
 * Regionen seier ikkje frå av seg sjølv (aria-live=off): skifta som er verd å seie frå om går via den felles
 * live-regionen (core crossingAnnouncement i usePositionState), aldri sekundteljing eller små posisjonsendringar.
 * `base` kjem frå model/nowcard.js (nowCardBase), `live` frå liveStatus.
 */
export function NowCard({ base, live }) {
  const view = usePositionState(live, { announce: true });
  const reducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const card = composeNowCard(base, view);
  if (!card) return null;
  return (
    <section
      className={`na na-${card.mode} na-state-${card.state}`}
      id="na-card"
      role="status"
      aria-live="off"
      aria-label={card.label}
      data-state={card.state}
      data-mode={card.mode}
      data-motion={reducedMotion ? "reduce" : undefined}
    >
      <p className="visually-hidden">{card.sentence}</p>
      <div className="na-body" aria-hidden="true">
        {card.tag ? (
          <span className="na-tag">
            <svg viewBox="0 0 16 16" className="na-tag-icon" focusable="false" aria-hidden="true">
              <path d="M2 8h10M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="0" />
            </svg>
            {card.tag}
          </span>
        ) : null}
        <p className="na-main">{card.main}</p>
        {card.support.map((line) => (
          <p key={line.kind} className={`na-support na-support-${line.kind}`}>
            <Bold text={line.text} />
          </p>
        ))}
        {card.scene ? <Scene scene={card.scene} reducedMotion={reducedMotion} ready={ready} /> : null}
        <div className="na-foot">
          <span className="na-badge" data-state={card.state} data-fresh={view?.pulse && !reducedMotion ? "1" : undefined}>
            <BadgeIcon icon={card.badge.icon} />
            <span className="na-badge-text">{card.badge.text}</span>
          </span>
        </div>
      </div>
    </section>
  );
}
