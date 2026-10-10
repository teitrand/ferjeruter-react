import { Fragment, useEffect, useRef, useState } from "react";
import { t } from "./i18n.js";
import { closeOnBackdrop, useModal } from "./useModal.js";
import { nextRadioIndex } from "../model/routes.js";

/** Størsta del av vindaugshøgda det faste kortet kan ta; over dette ligg det sist på sida (sjå RoutePicker). */
export const MAX_FIXED_SHARE = 0.35;

/** «Standal–Trandal» med brytepunkt berre etter tankestreken (ingen brot midt i eit stadnamn). */
function RouteName({ id }) {
  const parts = t(`route.${id}`).split("–");
  return parts.map((part, index) => (
    <Fragment key={part}>
      {index ? "–" : null}
      {index ? <wbr /> : null}
      {part}
    </Fragment>
  ));
}

function nextText(next) {
  if (!next) return null;
  if (next.when === "today") return t("route.row.next", { time: next.time });
  if (next.when === "tomorrow") return t("route.row.nextTomorrow", { time: next.time });
  return t("route.row.noService");
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="route-chevron" aria-hidden="true" focusable="false">
      <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M6 15l6-6 6 6" />
    </svg>
  );
}

function RouteRow({ item, index, rowRef, onSelect, onKeyDown }) {
  const soon = item.state === "soon";
  const selected = item.state === "selected";
  const sub = soon ? t("route.row.soon") : nextText(item.next);
  return (
    <button
      type="button"
      role="radio"
      ref={rowRef}
      className={`route-row${selected ? " is-selected" : ""}${soon ? " is-soon" : ""}`}
      aria-checked={selected}
      aria-disabled={soon ? "true" : undefined}
      tabIndex={selected ? 0 : -1}
      data-route={item.id}
      onClick={() => (soon ? null : onSelect(item.id))}
      onKeyDown={(event) => onKeyDown(event, index)}
    >
      <span className="route-mark" aria-hidden="true">
        {selected ? (
          <svg viewBox="0 0 24 24" focusable="false">
            <path fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M6 12.5l4 4 8-9" />
          </svg>
        ) : soon ? (
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : null}
      </span>
      <span className="route-row-text">
        <span className="route-row-name">
          <RouteName id={item.id} />
        </span>
        <span className="route-row-sub">
          {t("route.row.line", { line: item.line })}
          {sub ? <> · <span className={soon ? "route-row-soon" : "route-row-next"}>{sub}</span></> : null}
        </span>
      </span>
    </button>
  );
}

/**
 * Samband-veljaren: eit fast kort nederst («Valt samband», namnet og «Byt samband») som opnar eit ark
 * (<dialog>, modalt) med ei rad per samband. Radiogruppe med piltastar; Enter/mellomrom vel og lukkar.
 * Fokus går til valt rad ved opning og tilbake til kortet ved lukking (Esc, «Lukk» eller trykk på sløret).
 */
export function RoutePicker({ picker, onSelect }) {
  const [open, setOpen] = useState(false);
  // Stor tekst på lite skjerm: tek kortet meir enn ein tredjedel av høgda, ligg det i flyten sist på sida i staden for
  // å liggje fast over innhaldet (då kan «No»-raden aldri bli dekt, og sida får ikkje mindre plass enn ho treng).
  const [docked, setDocked] = useState(false);
  const dialogRef = useRef(null);
  const cardRef = useRef(null);
  const barRef = useRef(null);
  const rows = useRef([]);
  const drag = useRef(null);
  useModal(dialogRef, open);

  // Innhaldet får padding-bottom = høgda på kortet (veks ved stor tekst); ligg i --route-bar-h (styles/picker.css).
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return undefined;
    const root = document.documentElement;
    const update = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height);
      const tooTall = height > window.innerHeight * MAX_FIXED_SHARE;
      setDocked(tooTall);
      root.style.setProperty("--route-bar-h", tooTall ? "0px" : `${height}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // Fokus til valt rad når arket er opna.
  useEffect(() => {
    if (!open) return;
    const index = picker.items.findIndex((item) => item.state === "selected");
    rows.current[Math.max(index, 0)]?.focus();
  }, [open, picker.items]);

  const close = () => dialogRef.current?.close();
  const select = (id) => {
    close();
    if (id !== picker.selected) onSelect(id);
  };
  const onKeyDown = (event, index) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (picker.items[index].state !== "soon") select(picker.items[index].id);
      return;
    }
    const next = nextRadioIndex(picker.items, index, event.key);
    if (next == null) return;
    event.preventDefault();
    rows.current[next]?.focus();
  };
  const current = picker.items.find((item) => item.id === picker.selected);

  return (
    <>
      <div className={docked ? "route-bar is-docked" : "route-bar"} ref={barRef}>
        <button
          type="button"
          ref={cardRef}
          id="route-card"
          className="route-card"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="route-sheet"
          onClick={() => setOpen(true)}
          onPointerDown={(event) => (drag.current = event.clientY)}
          onPointerUp={(event) => {
            // Dra opp er ein snarveg; trykk og tastatur opnar på vanleg måte.
            if (drag.current != null && drag.current - event.clientY > 28) setOpen(true);
            drag.current = null;
          }}
        >
          <span className="route-card-text">
            <span className="route-card-label">{t("route.card.label")}</span>
            <span className="route-card-name">{current ? <RouteName id={current.id} /> : null}</span>
          </span>
          <span className="route-card-action">
            {t("route.card.change")}
            <Chevron />
          </span>
        </button>
      </div>
      <dialog
        ref={dialogRef}
        id="route-sheet"
        className="route-sheet"
        aria-modal="true"
        aria-labelledby="route-sheet-title"
        onClose={() => {
          setOpen(false);
          cardRef.current?.focus();
        }}
        onClick={closeOnBackdrop(dialogRef)}
      >
        <div className="route-sheet-inner">
          <span className="route-sheet-handle" aria-hidden="true" />
          <div className="route-sheet-head">
            <h2 id="route-sheet-title">{t("route.label")}</h2>
            <button type="button" className="route-sheet-close" onClick={close}>
              {t("route.sheet.close")}
            </button>
          </div>
          <div className="route-scroll">
          <div role="radiogroup" aria-labelledby="route-sheet-title" className="route-list">
            {picker.items.map((item, index) => (
              <RouteRow
                key={item.id}
                item={item}
                index={index}
                rowRef={(element) => (rows.current[index] = element)}
                onSelect={select}
                onKeyDown={onKeyDown}
              />
            ))}
          </div>
          <p className="route-sheet-note">{t("route.sheet.note")}</p>
          </div>
        </div>
      </dialog>
    </>
  );
}
