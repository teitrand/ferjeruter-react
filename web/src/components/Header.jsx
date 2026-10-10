import { useState } from "react";
import { Countdown } from "./Countdown.jsx";
import { InstallButton } from "./InstallDialog.jsx";
import { SettingsDialog } from "./SettingsDialog.jsx";
import { t } from "./i18n.js";

const MARK = "\u0000";

/** «Neste avgang 09:45 frå Trandal, om 4:05» med nedteljinga tikkande inne i setninga. */
function NextDeparture({ next }) {
  if (!next.departure) return next.text || t("lede.nextDeparture", next);
  const [before, after = ""] = t("lede.nextDeparture", { ...next, countdown: MARK }).split(MARK);
  return (
    <>
      {before}
      <Countdown time={next.departure} dayAhead={next.dayAhead || 0} />
      {after}
      {next.tag ? ` · ${next.tag}` : null}
    </>
  );
}

/**
 * Statusområdet: éi statuslinje (teksten kjem frå core currentStatus, som i vanilla-appen, retta
 * etter AIS-posisjonen). Sanntida (kjeldemerket og ferjelinja) står i «No»-raden i tidslinja.
 */
export function Lede({ lede }) {
  if (!lede) return null;
  if (lede.noTrips) {
    return <p className="lede" id="lede-status">{t("lede.noTripsToday")}</p>;
  }
  return (
    <div className="status-area">
      <p className="lede" id="lede-status">
        {lede.status ? lede.status : null}
        {lede.status && lede.next ? ". " : null}
        {lede.next ? <NextDeparture next={lede.next} /> : null}
        {lede.status || lede.next ? "." : null}
        {lede.logWarning ? (
          <>
            {" "}
            <span className="lede-warn">
              {lede.logWarning.when ? t("signal.logLate", { when: lede.logWarning.when }) : t("signal.logMissing")}
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}

const Gear = () => (
  <svg className="gear-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Toppen (Designer): tittelen (24 px) er hovudsaka, «Rute 1069 · Norled/Fram» under, eitt tannhjul (44 px) opnar
 * Innstillingar med språk og tema. Ingen merkeikon, stipla stripe eller appnamn.
 */
export function Header({ chrome, lede, ui, onLang, install = null, themeState = null }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <header className={chrome ? "site-header" : "site-header is-pending-route"}>
      <div className="header-top">
        <div className="header-heading">
          <div className="header-title">
            <h1 id="route-title">{t(chrome?.titleKey || "route.title1136")}</h1>
            {chrome?.kombi ? (
              <span id="route-badge" className="route-badge">
                {t("route.badgeKombi")}
              </span>
            ) : null}
          </div>
          <p className="eyebrow">{t(chrome?.eyebrowKey || "eyebrow")}</p>
        </div>
        <div className="header-tools">
          <InstallButton visible={Boolean(install?.visible)} onClick={() => install?.install()} />
          <button
            type="button"
            className="settings-btn"
            aria-label={t("settings.open")}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            aria-controls="settings-dialog"
            title={t("settings.open")}
            onClick={() => setSettingsOpen(true)}
          >
            <Gear />
          </button>
        </div>
      </div>
      <Lede lede={lede} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} lang={ui.lang} onLang={onLang} themeState={themeState} />
    </header>
  );
}
