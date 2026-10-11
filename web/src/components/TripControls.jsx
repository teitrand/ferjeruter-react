import { useAnnounce } from "./Announcer.jsx";
import { t } from "./i18n.js";

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 8h11M15 5l3 3-3 3M17 16H6M9 13l-3 3 3 3"
      />
    </svg>
  );
}

function PlaceField({ id, label, quays, value, onChange }) {
  return (
    <label className="place-field">
      <span className="place-label">{label}</span>
      <select id={id} className={value ? "place-select has-value" : "place-select"} value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t("stops.all")}</option>
        {quays.map((quay) => (
          <option key={quay} value={quay}>
            {quay}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Frå/til med byteknapp. `place` kjem frå placeFilterModel. */
export function PlaceFilter({ place, dispatch }) {
  return (
    <div id="trip-filter" className="trip-filter" role="group" aria-label={t("stop.filterAria")}>
      {place.quays.length ? (
        <>
          <PlaceField id="from-stop" label={t("place.from")} quays={place.from} value={place.filters.from} onChange={(value) => dispatch({ type: "from", value })} />
          <button type="button" className="swap-dir" aria-label={t("place.swap")} title={t("place.swap")} disabled={!place.canSwap} onClick={() => dispatch({ type: "swap" })}>
            <SwapIcon />
          </button>
          <PlaceField id="to-stop" label={t("place.to")} quays={place.to} value={place.filters.to} onChange={(value) => dispatch({ type: "to", value })} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Korrespondanse øvst, så éi rad med to like små knappar: «Vis/Skjul ankomsttider» (til venstre, held plassen sin) og
 * «Nullstill filter» (til høgre, berre når eit filter er på). `connection` kjem frå connectionModel.
 * Ankomsttida-knappen har namn etter handlinga (ikkje aria-pressed, så namnet og tilstanden seier ikkje imot kvarandre).
 * «Nullstill filter» set Frå/Til til «Alle stopp» og korrespondanse til «Ingen» og rører ikkje noko anna; fokus går til
 * Frå-vala (knappen forsvinn), og nullstillinga blir sagt høfleg frå til skjermlesar.
 */
export function ExtrasRow({ showArrivals, onToggleArrivals, connection, onConnection, resetActive = false, onReset = () => {} }) {
  const announce = useAnnounce();
  return (
    <div className="extras-row" role="group" aria-label={t("extras.filterAria")}>
      <div id="conn-filter" className="conn-filter" role="group" aria-label={t("conn.label")}>
        {connection.lines.length ? (
          <label className="conn-field">
            <span className="conn-label">{t("conn.label")}</span>
            <select
              className={connection.value ? "conn-select has-value" : "conn-select"}
              aria-label={t("conn.label")}
              value={connection.value || ""}
              onChange={(e) => onConnection(e.target.value || null)}
            >
              <option value="">{t("conn.none")}</option>
              {connection.lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="extras-actions">
        <div id="view-filter" className="filters" role="group" aria-label={t("view.label")}>
          <button type="button" id="toggle-arrivals" className="chip chip-small" onClick={onToggleArrivals}>
            {showArrivals ? t("view.hideArrivals") : t("view.showArrivals")}
          </button>
        </div>
        {resetActive ? (
          <button
            type="button"
            id="reset-filters"
            className="chip chip-small reset-filters-btn"
            onClick={() => {
              onReset();
              announce(t("filters.resetDone"));
              document.getElementById("from-stop")?.focus();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
            </svg>
            {t("filters.reset")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
