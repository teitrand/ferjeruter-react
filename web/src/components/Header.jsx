import { Countdown } from "./Countdown.jsx";
import { InstallButton } from "./InstallDialog.jsx";
import { LangSwitch } from "./LangSwitch.jsx";
import { ThemeSwitch } from "./ThemeSwitch.jsx";
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

/**
 * Toppen: språkflagg og ein liten temaknapp øvst til høgre, så tittelen (24 px) som hovudsak med «Rute 1069 · Norled/Fram»
 * under. Ingen merkeikon, stipla stripe eller appnamn.
 */
export function Header({ chrome, lede, ui, onLang, install = null, themeState = null }) {
  return (
    <header className={chrome ? "site-header" : "site-header is-pending-route"}>
      <div className="header-tools">
        <LangSwitch lang={ui.lang} onChange={onLang} />
        {themeState ? <ThemeSwitch pref={themeState.pref} onChange={themeState.setPref} /> : null}
        <InstallButton visible={Boolean(install?.visible)} onClick={() => install?.install()} />
      </div>
      <div className="header-title">
        <h1 id="route-title">{t(chrome?.titleKey || "route.title1136")}</h1>
        {chrome?.kombi ? (
          <span id="route-badge" className="route-badge">
            {t("route.badgeKombi")}
          </span>
        ) : null}
      </div>
      <p className="eyebrow">{t(chrome?.eyebrowKey || "eyebrow")}</p>
      <Lede lede={lede} />
    </header>
  );
}
