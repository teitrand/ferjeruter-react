import { FRAMMR_URL, NAIS_URL } from "../../../packages/core/index.js";
import { t } from "./i18n.js";

/**
 * Fotnoten under rutetabellen: berre det som gjeld ruta (signalturar, korrespondanse, papir-ruteplan, ferja på NAIS).
 * Generell info om data og kjelder ligg heilt nede i bunnteksten (Footer, «Om dataa»).
 * `notes` kjem frå footnoteModel, `connection` frå connectionModel.
 */
export function Footnote({ notes, connection }) {
  return (
    <p className="footnote">
      <span>{t("footnote.signal")}</span> <span id="connection-note">{connection}</span> <span>{t("footnote.pdf")}</span>:{" "}
      <a id="timetable-pdf" href={notes.pdf.href} target="_blank" rel="noreferrer">
        {notes.pdf.text}
      </a>{" "}
      ·{" "}
      <a href={FRAMMR_URL} target="_blank" rel="noreferrer">
        frammr.no
      </a>{" "}
      ·{" "}
      <a id="footnote-nais" href={NAIS_URL} target="_blank" rel="noreferrer">
        {notes.nais}
      </a>
    </p>
  );
}
