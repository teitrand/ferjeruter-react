import { useEffect, useRef } from "react";
import { isNoPassengerTrip, telHref } from "../../../packages/core/index.js";
import { useAnnounce } from "./Announcer.jsx";
import { CallLink } from "./CallLink.jsx";
import { t } from "./i18n.js";

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="stop-phone-icon" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
      />
    </svg>
  );
}

/** «På signal» (med ringelenkje når vi har nummer) eller «Bestilt signaltur». */
function SignalTag({ row }) {
  if (row.tag === "booked") return <span className="stop-tag stop-tag-booked">{t("signal.booked")}</span>;
  const href = !row.cancelled ? telHref(row.phone) : "";
  if (!href) return <span className="stop-tag">{t("signal.onRequest")}</span>;
  const label = t("signal.callAria", { phone: row.phone });
  return (
    <CallLink className="stop-tag stop-tag-call" phone={row.phone} how="tag" aria-label={label} title={label}>
      {t("signal.onRequest")}
      <PhoneIcon />
    </CallLink>
  );
}

function SignalNote({ note }) {
  const label = t("signal.callBy", { time: note.time });
  const href = telHref(note.phone);
  return (
    <span className="stop-note">
      {href ? (
        <CallLink className="stop-phone" phone={note.phone} how="note">
          {`${label} · ${note.phone}`}
        </CallLink>
      ) : (
        label
      )}
      {note.left ? <span className="stop-left">{t("signal.leftToBook", { duration: note.left })}</span> : null}
      {note.expired ? <span className="stop-expired">{t("signal.expired")}</span> : null}
    </span>
  );
}

/** Éi avgang. Status (inkl. «Ukjent») kjem ferdig frå tripStatus via modellen. Klikk opnar detaljane. */
export function DepartureRow({ row, onDetail }) {
  const className = [
    "stop stop-dep",
    row.past && "is-past",
    row.cancelled && "is-cancelled",
    row.skipped && "is-signal-off",
    row.onward && "stop-onward",
  ]
    .filter(Boolean)
    .join(" ");
  const signal = row.skipped ? "skipped" : row.state === "unknown" ? "unknown" : undefined;
  // Status-in (240 ms) berre når statusen endrar seg medan sida er open, ikkje ved fyrste teikning.
  const firstState = useRef(row.state);
  const changed = row.state !== firstState.current;
  return (
    <div
      className={className}
      data-state={row.state || undefined}
      onClick={(event) => {
        if (!event.target.closest("a, button")) onDetail?.(row.leg);
      }}
    >
      <span className="stop-time">{row.time}</span>
      <span className="stop-body">
        <span className="stop-head">
          <button
            type="button"
            className="stop-name stop-detail"
            aria-haspopup="dialog"
            aria-controls="departure-dialog"
            onClick={() => onDetail?.(row.leg)}
          >
            {t("sailing.route", { from: row.from, to: row.to })}
          </button>
          {row.cancelled ? <span className="stop-tag stop-tag-stop">{t("sailing.cancelled")}</span> : null}
          {row.tag ? <SignalTag row={row} /> : null}
        </span>
        {row.arrival ? <span className="stop-note stop-eta">{t("sailing.arrival", { time: row.arrival })}</span> : null}
        {row.via ? <span className="stop-note stop-conn">{row.via}</span> : null}
        {!row.cancelled && row.signalNote ? <SignalNote note={row.signalNote} /> : null}
        {row.stillAtQuay ? <span className="stop-note">{t("signal.stillAtQuay")}</span> : null}
        {(row.notes || []).map((note) => (
          <span key={note} className="stop-note stop-conn">
            {note}
          </span>
        ))}
      </span>
      <span key={row.state || "none"} className={changed ? "stop-state status-in" : "stop-state"} data-signal={signal}>
        {row.stateText}
      </span>
    </div>
  );
}

function LayoverRow({ row }) {
  return (
    <div className={row.past ? "stop stop-layover is-past" : "stop stop-layover"}>
      <span className="stop-time">{row.time}</span>
      <span className="stop-body">
        <span className="stop-name">{row.named ? t("layover.atQuay", { quay: row.quay }) : t("layover.title")}</span>
        <span className="stop-note">{t("layover.until", { duration: row.duration, time: row.until })}</span>
      </span>
      <span className="stop-state" />
    </div>
  );
}

/** Venting på overgang (frå/til over Sæbø). */
function WaitRow({ row }) {
  return (
    <div className={row.past ? "stop stop-layover stop-wait stop-onward is-past" : "stop stop-layover stop-wait stop-onward"}>
      <span className="stop-time">{row.time}</span>
      <span className="stop-body">
        <span className="stop-name">{t("place.waitAt", { quay: row.quay, duration: row.duration })}</span>
        <span className="stop-note">{t("place.waitUntil", { time: row.until })}</span>
      </span>
      <span className="stop-state" />
    </div>
  );
}

function SplitRow({ row }) {
  return (
    <div className={row.past ? "stop-split is-past" : "stop-split"} role="separator">
      <span className="split-kicker">{t("split.kicker")}</span>
      <span className="split-title">
        {t("split.continues", {
          table: t(`split.table.${row.table}`),
          time: row.time,
          quay: row.quay ? t("split.atQuay", { quay: row.quay }) : "",
        })}
      </span>
      <span className="split-before">{t("split.before", { before: t(`split.table.${row.before}`) })}</span>
      {row.notice ? <span className="split-before">{t("mode.acuteNote", { from: row.notice, to: row.time })}</span> : null}
    </div>
  );
}

function TransferRow({ row }) {
  return (
    <div className={row.past ? "stop stop-transfer is-past" : "stop stop-transfer"}>
      <span className="stop-time" />
      <span className="stop-body">
        <span className="stop-name">{t("transfer.moves", { to: row.to })}</span>
        {/* «Utan passasjerar» berre til og frå Valderøya; elles ingen merknad. */}
        {row.crossesArea || isNoPassengerTrip(row.from, row.to) ? (
          <span className="stop-note">
            {row.crossesArea ? t("transfer.noPassengers", { from: row.from, to: row.to }) : t("transfer.empty")}
          </span>
        ) : null}
      </span>
      <span className="stop-state" />
    </div>
  );
}

/** «Søndag 11. oktober»: 1069 går heile døgnet, så lista held fram over midnatt. */
function DayHeadRow({ row }) {
  return <h3 className="timeline-dayhead">{row.label}</h3>;
}

const ROWS = { dayhead: DayHeadRow, dep: DepartureRow, layover: LayoverRow, wait: WaitRow, split: SplitRow, transfer: TransferRow };

/** Berre dårlege nyhende blir lesne opp. «Gått» o.l. kjem ikkje i live-regionen. */
const BAD_NEWS = new Set(["cancelled", "notRunning", "unknown"]);

/**
 * Seier frå i den felles live-regionen når ei avgang blir avlyst, ikkje utført eller
 * ukjend medan sida er open. Fleire samtidige skifte blir éi melding. Ikkje ved fyrste
 * teikning, dagbyte eller rutebyte.
 */
function useDepartureAnnouncements(rows, scope) {
  const announce = useAnnounce();
  const seen = useRef(null);
  const seenScope = useRef(scope);
  useEffect(() => {
    if (!scope || seenScope.current !== scope) {
      seenScope.current = scope;
      seen.current = null;
      if (!scope) return;
    }
    const now = new Map();
    for (const row of rows || []) {
      if (row.kind === "dep" && !row.past) now.set(row.key, row);
    }
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    const changes = [];
    for (const [key, row] of now) {
      const old = before.get(key);
      if (old && old.state !== row.state && BAD_NEWS.has(row.state) && row.stateText) {
        changes.push(t("crossing.annDeparture", { route: t("sailing.route", { from: row.from, to: row.to }), time: row.time, status: row.stateText }));
      }
    }
    if (changes.length) announce(changes.join(" "));
  }, [rows, scope, announce]);
}

/**
 * «No» som eit utvida punkt på tidslinja: kortet (NowCard) står mellom det som er gått og det som kjem, med eigen
 * prikk på lina. Regionen med role=status ligg i kortet sjølv; her er berre plasseringa.
 */
function NowRow({ slot }) {
  return <div className="timeline-now">{slot}</div>;
}

function TimelineRows({ timeline, showPast, onTogglePast, onDetail, nowSlot = null }) {
  useDepartureAnnouncements(timeline.rows, timeline.scope);
  if (timeline.empty) {
    return (
      <div className="timeline">
        <p className="empty">{t(timeline.empty)}</p>
      </div>
    );
  }
  return (
    <>
      <div>
        {timeline.pastCount ? (
          <button type="button" className="reveal" onClick={onTogglePast}>
            {showPast ? t("reveal.hide") : t("reveal.show", { n: timeline.pastCount })}
          </button>
        ) : null}
      </div>
      <div className="timeline">
        {timeline.rows.map((row) => {
          // «No»-hendinga ordnar tidlegare/komande; kortet (nowSlot) blir sett inn der ho ligg.
          if (row.kind === "now") return nowSlot ? <NowRow key={row.key} slot={nowSlot} /> : null;
          const Row = ROWS[row.kind];
          return Row ? <Row key={row.key} row={row} onDetail={onDetail} /> : null;
        })}
        {timeline.emptyPlace ? <p className="empty">{timeline.emptyPlace}</p> : null}
      </div>
    </>
  );
}

/** Tidslinja for den valde dagen. `timeline` kjem frå model/timeline.js. Live-regionen kjem frå AnnouncerProvider rundt appen. */
export function Timeline(props) {
  return <TimelineRows {...props} />;
}
