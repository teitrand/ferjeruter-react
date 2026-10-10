/**
 * Rammene rundt rutetabellen, felles for vanilla og React: fotnotar (papirruteplan,
 * NAIS, posisjon), tilbakemelding på e-post, og kvar data skal lesast frå på /dev/.
 */
import { t } from "../../assets/i18n.js?v=84";
import { ALLOWED_MODES } from "./plan.js?v=84";
import { liveStatus } from "./status.js?v=84";
import { bestFix, fixFreshness } from "./crossing.js?v=84";

export const FEEDBACK_MAIL = "teitrand@hotmail.com";
export const FEEDBACK_GITHUB = "https://github.com/teitrand/fergeruter/issues/new";
export const KOMBI_PDF =
  "https://frammr.no/_f/p2/i2e02cdba-2cdc-4a23-b9bf-f6a6bd437bbe/kombinasjonsrute-sabo-leknes-skar-trandal-standal-20251118.pdf";
export const FJORD1_PDF =
  "https://www.fjord1.no/ruteoversikt/moere-og-romsdal/standal-trandal-valderoeya-store-kalvoey/(page)/pdf";
export const FJORD1_PDF_1135 = "https://www.fjord1.no/ruteoversikt/moere-og-romsdal/leknes-saeboe/(page)/pdf";
export const FJORD1_PDF_1049 = "https://www.fjord1.no/ruteoversikt/moere-og-romsdal/festoeya-hundeidvika/(page)/pdf";
export const FRAMMR_URL = "https://frammr.no/";
export const NAIS_URL = "https://nais.kystverket.no/";
export const FJORD1_SMS_URL = "https://www.fjord1.no/kundeservice/foer-du-reiser/SMS-om-trafikken";

export function feedbackMailto(rating, comment) {
  const ratingLabel = rating === "yes" ? t("feedback.yes") : t("feedback.no");
  const text = String(comment || "").trim() || t("feedback.mailNoComment");
  const subject = t("feedback.mailSubject");
  const body = t("feedback.mailBody", { rating: ratingLabel, comment: text });
  return `mailto:${FEEDBACK_MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Papirruteplan og NAIS-lenkja for sambandet som gjeld. `vessel` er ferja som går
 * kombiruta, 1135 eller 1049 ({ name }), null på 1136.
 * @returns {{ pdf: { href: string, text: string }, nais: string }}
 */
export function routeFootnotes(mode, { kombirute = null, vessel = null } = {}) {
  let pdf = { href: FJORD1_PDF, text: "fjord1.no" };
  if (mode === "kombi") pdf = { href: kombirute?.source || KOMBI_PDF, text: t("footnote.kombiPdf") };
  else if (mode === "1135") pdf = { href: FJORD1_PDF_1135, text: "fjord1.no" };
  else if (mode === "1049") pdf = { href: FJORD1_PDF_1049, text: "fjord1.no" };
  return {
    pdf,
    nais: vessel ? t("footnote.naisVessel", { name: vessel.name }) : t("footnote.nais"),
  };
}

/**
 * Fotnoten om posisjonen. Når Entur strupar, manglar svaret CORS-hovud, så
 * nettlesaren ser berre «Failed to fetch» og aldri 429. Difor reknar vi kvar
 * feil ved kallet som «fekk ikkje kontakt», og tomt svar som «ingen posisjon».
 */
export function positionNoteKey(live, liveFailed, quays, fixes = null, nowMs = Date.now()) {
  // `fixes` er null i vanilla-appen (berre Entur). I React-skalet er det alle målte
  // posisjonar (Entur og AIS); då nemner noten berre kjelda posisjonen faktisk kjem frå.
  if (fixes) {
    const best = bestFix(fixes, nowMs);
    if (best && fixFreshness(best, nowMs) === "live") return best.source === "ais" ? "position.liveAis" : "position.live";
    if (liveFailed) return "position.offline";
    return "position.plannedAny";
  }
  if (liveStatus(live, quays)) return "position.live";
  if (liveFailed) return "position.offline";
  return "position.planned";
}

/**
 * Lokal utvikling, /dev/ på Pages og førehandsvisinga av React-skalet
 * (teitrand.github.io/ferjeruter-react/). Produksjon (rota av eige domene) tek ikkje ?rute=.
 */
export function isPreview(loc) {
  if (!loc) return false;
  const host = loc.hostname || "";
  const path = loc.pathname || "";
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    path.includes("/dev/") ||
    path === "/ferjeruter-react" ||
    path.startsWith("/ferjeruter-react/")
  );
}

/** ?rute=1136|1135|1049|kombi, berre i førehandsvising. */
export function routeOverride(loc) {
  if (!isPreview(loc)) return null;
  try {
    const raw = new URL(loc.href, "https://teitrand.github.io").searchParams.get("rute");
    return ALLOWED_MODES.has(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Testhost /dev/ les produksjonsfila for meldingar og signallogg (Actions oppdaterer
 * berre main). Utanfor /dev/ blir `file` ståande som han er.
 */
export function productionDataUrl(loc, file) {
  const path = String(loc?.pathname || "");
  if (!path.includes("/dev/")) return file;
  try {
    let origin = loc.origin;
    if (!origin && loc.href) origin = new URL(loc.href).origin;
    if (!origin) return file;
    const prefix = path.slice(0, path.indexOf("/dev/"));
    return `${origin}${prefix}/data/${file.replace(/^data\//, "")}`;
  } catch {
    return file;
  }
}
