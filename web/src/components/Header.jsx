import { Countdown } from "./Countdown.jsx";
import { InstallButton } from "./InstallDialog.jsx";
import { LangSwitch } from "./LangSwitch.jsx";
import { t } from "./i18n.js";

const ROUTES = ["1136", "1135", "1049"];

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#073b4c" />
      <path d="M8 42c6 4 12 4 18 0s12-4 18 0 12 4 18 0" fill="none" stroke="#7ec8c3" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 38 32 20l10 6h8l-6 12H18z" fill="#f4efe4" />
      <rect x="28" y="16" width="3" height="10" fill="#e07a3d" />
    </svg>
  );
}

/** Samband: Standal–Trandal (1136), Sæbø–Leknes (1135) eller Festøya–Hundeidvik (1049). Kombirute kjem frå meldingane. */
function RouteSwitch({ routeChoice, routes, onChange }) {
  // Eit lagra val som ikkje finst (1049 før tabellen har linja) viser 1136 som valt, som resten av appen.
  const active = routes.includes(routeChoice) ? routeChoice : "1136";
  return (
    <div className="header-routes">
      <span id="route-switch-label" className="route-switch-label">
        {t("route.label")}
      </span>
      <div className="filters route-switch" role="group" aria-labelledby="route-switch-label">
        {routes.map((value) => (
          <button
            key={value}
            type="button"
            className={active === value ? "chip is-active" : "chip"}
            aria-pressed={active === value}
            onClick={() => onChange(value)}
          >
            {t(`route.${value}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

const MARK = "\u0000";

/** «Neste avgang 09:45 frå Trandal, om 4:05» med nedteljinga tikkande inne i setninga. */
function NextDeparture({ next }) {
  if (!next.departure) return next.text || t("lede.nextDeparture", next);
  const [before, after = ""] = t("lede.nextDeparture", { ...next, countdown: MARK }).split(MARK);
  return (
    <>
      {before}
      <Countdown time={next.departure} />
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

export function Header({ chrome, lede, ui, routes = ROUTES, onRoute, onLang, install = null }) {
  return (
    <header className={chrome ? "site-header" : "site-header is-pending-route"}>
      <div className="header-tools">
        <LangSwitch lang={ui.lang} onChange={onLang} />
        <InstallButton visible={Boolean(install?.visible)} onClick={() => install?.install()} />
      </div>
      <BrandMark />
      <p className="eyebrow">{t(chrome?.eyebrowKey || "eyebrow")}</p>
      <div className="header-title">
        <h1 id="route-title">{t(chrome?.titleKey || "route.title1136")}</h1>
        {chrome?.kombi ? (
          <span id="route-badge" className="route-badge">
            {t("route.badgeKombi")}
          </span>
        ) : null}
      </div>
      <RouteSwitch routeChoice={ui.routeChoice} routes={routes} onChange={onRoute} />
      <Lede lede={lede} />
    </header>
  );
}
