import { NAIS_URL } from "../../../packages/core/index.js";
import { CallLink } from "./CallLink.jsx";
import { t } from "./i18n.js";

/** Teksten med telefonnummeret som ringelenkje, som linkifyPhone() i vanilla-appen. */
function Operator({ text, phone }) {
  const at = phone ? text.indexOf(phone) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <CallLink className="footer-phone" phone={phone} how="footer" aria-label={t("signal.callAria", { phone })}>
        {phone}
      </CallLink>
      {text.slice(at + phone.length)}
    </>
  );
}

const NLOD_URL = "https://data.norge.no/nlod/no/2.0";

/**
 * «Om dataa»: samanleggbar og kort. Kva posisjonen kjem frå no (same tekst som før i fotnoten, id
 * position-note), kva «Live» og «Siste kjende» betyr, kjeldene og rutetabellen.
 */
function AboutData({ notes }) {
  return (
    <details className="about-data" id="about-data">
      <summary>{t("about.title")}</summary>
      <dl>
        <dt>{t("about.position")}</dt>
        <dd>
          <span id="position-note">{t(notes.position)}</span> {t("about.priority")}
        </dd>
        <dd>{t("about.ages")}</dd>
        <dt>{t("about.sources")}</dt>
        <dd>
          <ul>
            <li>{t("about.ais")}</li>
            <li>{t("about.entur")}</li>
          </ul>
        </dd>
        <dt>{t("about.timetable")}</dt>
        <dd>
          {t("footnote.timetable")}{" "}
          <span id="timetable-updated">{notes.updated ? t("timetable.updated", { date: notes.updated }) : ""}</span>
        </dd>
      </dl>
    </details>
  );
}

/** Heilt nede: operatør og ferjetelefon, kjeldekreditering (AIS frå Kystverket, NLOD), «Om dataa», høgtidsmerknad og tilbakemelding. */
export function Footer({ chrome, notes, onFeedback }) {
  const vessel = chrome?.vessel;
  // 1049: ferjetelefon er ikkje kjend (ingen signalturar), så berre operatør og ruteeigar.
  const noPhone = chrome?.mode === "1049";
  const phone = noPhone ? "" : vessel ? vessel.phone : "916 69 340";
  const text = noPhone ? t("footer.operator1049", { name: vessel?.name || "" }) : vessel ? t("footer.operatorVessel", { name: vessel.name, phone }) : t("footer.operator");
  return (
    <footer className="site-footer">
      <p>
        <span id="footer-operator">
          <Operator text={text} phone={phone} />
        </span>
      </p>
      <p id="footer-credit">
        {t("footer.credit")}{" "}
        <a href={NAIS_URL} target="_blank" rel="noreferrer">
          NAIS
        </a>{" "}
        ·{" "}
        <a href={NLOD_URL} target="_blank" rel="noreferrer">
          {t("footer.licence")}
        </a>
      </p>
      <p>{t(chrome?.mode === "1049" ? "footer.holidays1049" : "footer.holidays")}</p>
      {notes ? <AboutData notes={notes} /> : null}
      <p>
        <button type="button" id="feedback-open" className="feedback-link" onClick={onFeedback}>
          {t("feedback.open")}
        </button>
      </p>
    </footer>
  );
}
