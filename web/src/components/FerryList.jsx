import { ferryBadge, ferryName, ferrySentence, ferryText } from "../model/ferries.js";
import { t } from "./i18n.js";
import { BadgeIcon } from "./NowCard.jsx";

/**
 * Ferjelista for samband med fleire ferjer (1069): éi tekstrad per ferje, ingen teikning. Kvar rad har éi kort setning for
 * skjermlesar (synleg tekst er aria-hidden). Ingen live-region og ingen sekundteljar: alderen i setninga er rund til minutt.
 * `model` kjem frå model/ferries.js (ferryRows).
 */
export function FerryList({ model }) {
  const items = model.rows.length ? model.rows : model.calc ? [model.calc] : [];
  if (!items.length) return null;
  return (
    <section className="ferries">
      <ul className="ferries-list" aria-label={t("ferries.label")}>
        {items.map((row) => {
          const badge = ferryBadge(row);
          const speed = row.speedKn != null ? t("speed.knots", { n: row.speedKn }).replace(" ", "\u00a0") : null; // «9 knop» skal ikkje brytast
          return (
            <li key={row.key} className={`ferry-row is-${row.kind}`} data-state={row.state}>
              <span className="visually-hidden">{ferrySentence(row)}</span>
              <span className="ferry-body" aria-hidden="true">
                <span className="ferry-main">
                  {row.kind === "calc" ? null : <b className="ferry-name">{row.name}</b>}
                  {row.kind === "calc" ? null : " · "}
                  {ferryText(row)}
                  {speed ? ` · ${speed}` : null}
                </span>
                <span className="na-badge ferry-badge" data-state={row.state}>
                  <BadgeIcon icon={badge.icon} />
                  <span className="na-badge-text">{badge.text}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
