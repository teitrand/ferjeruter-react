/**
 * «No»-kortet (Designer V2): hovudlinje = kvar ferja er, støttelinje = knop/avgang/framkomst, ferja på ei linje mellom
 * kaiane, og eit lite kjeldemerke nederst. Rein modell utan DOM; alle tider og tal kjem frå rutetabellen og posisjonen
 * (ingenting er funne på; «12 min» i skissene er eit døme).
 *
 *  nowCardBase     det som endrar seg med turar og status (ledeModel, ein gong per minutt/data)
 *  composeNowCard  base + posisjonstilstand som tikkar kvart sekund (usePositionState) → tekstar, merke og scene
 */
import { FIX_FRESH_MS, fixFreshness, naisVesselUrl, approachBadge, approachText, bestFix, clockMinutes, durationText, fixAtQuay, formatDay, hhmm, osloHm, quayPlace } from "../../../packages/core/index.js";
import { t } from "../components/i18n.js";
import { positionFixes } from "./crossing.js";

const legPart = (leg) => (leg ? { from: leg.from, to: leg.to, departure: hhmm(leg.departure), arrival: hhmm(leg.arrival) } : null);

/**
 * @param {object} p
 * @param {object|null} p.status  statuslinja (nowStatus)
 * @param {{ lines: object[], leg: object|null, legKind: string|null }} p.info  nowInfo
 * @param {{ crossing: { leg: object }|null, pending?: boolean }} p.live  liveStatus
 * @param {string[]} p.quays  knownQuays
 */
export function nowCardBase({ status, info, live, data, quays, nowMs = Date.now() }) {
  if (!status) return null;
  const line = (kind) => info?.lines?.find((item) => item.kind === kind)?.text || null;
  const best = bestFix(positionFixes(data), nowMs);
  const lastQuay = best ? (quays || []).find((name) => fixAtQuay(best, name)) || null : null;
  const crossing = live?.crossing?.leg || null;
  let mode = "other";
  if (status.outside) mode = "outside";
  else if (status.unscheduled) mode = "unscheduled";
  else if (status.underway && crossing) mode = "underway";
  else if (status.atQuay) mode = "moored";
  const leg = mode === "underway" ? crossing : mode === "moored" || mode === "other" ? info?.leg || null : null;
  return {
    mode,
    quay: status.atQuay || null,
    place: line("place") || "",
    leg: legPart(leg),
    legKind: mode === "underway" ? "crossing" : info?.legKind || null,
    legAhead: info?.legAhead || 0,
    legDay: info?.legDay || null,
    scheduled: line("scheduled"),
    cancelled: line("cancelled"),
    lastQuay,
    pending: Boolean(live?.pending),
    // Forflytting til startkaia for turen kortet viser: ferja er ikkje der enno.
    toQuay: mode !== "underway" && status.toQuay && leg && quayPlace(status.toQuay) === quayPlace(leg.from) ? leg.from : null,
  };
}

function ageText(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? t("crossing.seconds", { n: seconds }) : durationText(Math.floor(seconds / 60));
}

const clockOf = (ms) => (ms == null ? "" : osloHm(new Date(ms).toISOString()));

/** «KVERNES» (AIS) → «M/F Kvernes»; utan namn «ferja». */
function vesselTitle(name) {
  const text = String(name || "").trim();
  if (!text) return t("na.naisFerry");
  return `M/F ${text.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())}`;
}

function sailMinutes(leg) {
  const minutes = clockMinutes(leg.arrival) - clockMinutes(leg.departure);
  return minutes > 0 ? minutes : null;
}

/** Kjeldemerket nederst: ikon + tekst (aldri berre farge), utan dobbelt «≈»: ikonet er teiknet, teksten har ikkje teiknet. */
export function badgeFor(state, view) {
  switch (state) {
    case "live":
      return { icon: "live", text: crossingBadgeText(view, "live") };
    case "stale":
      return { icon: "clock", text: crossingBadgeText(view, "stale") };
    case "unknown":
      return { icon: "clock", text: t("na.badgeLast", { age: ageText(view.ageMs ?? 0) }) };
    case "outside":
      // På veg til ei kai på ruta (AIS-destinasjonen): blått merke «Destinasjon frå AIS», elles «Siste kjende frå AIS».
      if (view.approach) return { icon: (view.ageMs ?? 0) <= FIX_FRESH_MS ? "live" : "clock", text: approachBadge(view), tone: "approach" };
      return { icon: "live", text: crossingBadgeText(view, (view.ageMs ?? 0) < FIX_FRESH_MS ? "live" : "stale") };
    case "loading":
      return { icon: "loading", text: t("crossing.loading") };
    default:
      return { icon: "calc", text: t("crossing.calc") };
  }
}

function crossingBadgeText(view, kind) {
  const base = kind === "live" ? "crossing.live" : "crossing.lastKnown";
  return t(`${base}${view.source === "entur" ? "Entur" : "Ais"}`, { age: ageText(view.ageMs ?? 0) });
}

/**
 * @param {ReturnType<typeof nowCardBase>} base
 * @param {object|null} view  usePositionState: crossingView (overfart) eller positionSourceView
 */
export function composeNowCard(base, view) {
  if (!base) return null;
  const mode = view?.state === "outside" ? "outside" : base.mode;
  let state = view?.state || "calc";
  if (base.pending && (state === "calc" || state === "unknown")) state = "loading";
  const leg = base.leg;
  const underway = mode === "underway";
  const measured = state === "live" || state === "stale";
  const support = [];
  let main = base.place;
  let head = base.place; // setninga til skjermlesar, same meining utan «Ferja»-forkortinga
  let tag = null;

  const approach = mode === "outside" ? view?.approach || null : null;
  if (approach) {
    main = head = approachText(approach);
  } else if (mode === "outside") {
    tag = t("na.tagOutside");
    main = head = t("status.outside");
    support.push({ kind: "note", text: t("crossing.noteOutside") });
  } else if (state === "unknown") {
    main = t("crossing.unknownSince", { time: clockOf(view?.fixAt) });
    head = main;
    if (base.lastQuay) support.push({ kind: "note", text: t("na.lastSeenAt", { quay: base.lastQuay }) });
    support.push({ kind: "note", text: t("na.unknownWhere") });
  } else if (underway && leg) {
    main = t(measured ? "na.underway" : "na.underwayCalc", { dest: leg.to });
    head = t(measured ? "status.underwayTo" : "na.underwayCalc", { dest: leg.to });
    const arrival = view?.arrival || leg.arrival;
    if (measured) {
      const parts = [];
      if (view?.speedKn != null) parts.push(t("speed.knots", { n: view.speedKn }));
      if (arrival) parts.push(t("na.arrives", { time: arrival }));
      if (parts.length) support.push({ kind: "move", text: parts.join(" · ") });
    } else if (arrival) {
      support.push({ kind: "move", text: t("na.calcSupport", { time: arrival }) });
    }
  } else if (mode === "moored" && base.quay) {
    main = t("na.moored", { quay: base.quay });
    head = t("status.mooredAt", { quay: base.quay });
  }

  // Ved kai (AIS eller rutetabell): planlagd avgang og overfart frå turen kortet viser planen for.
  if (!underway && mode !== "outside" && state !== "unknown" && leg) {
    const from = quayPlace(leg.from);
    const here = base.toQuay ? false : base.quay ? quayPlace(base.quay) === from : true;
    if (base.legKind === "first") {
      const day = base.legDay ? formatDay(base.legDay) : "";
      const text = here
        ? t(base.legAhead === 1 ? "na.firstTomorrow" : "na.firstOn", { time: leg.departure, dest: leg.to, day })
        : t(base.legAhead === 1 ? "now.firstTomorrow" : "now.firstDay", { time: leg.departure, from: leg.from, day });
      support.push({ kind: "plan", text });
    } else if (base.legKind === "scheduled" && base.scheduled) support.push({ kind: "delay", text: base.scheduled });
    else if (here) support.push({ kind: "plan", text: t("na.planDeparture", { time: leg.departure, dest: leg.to }) });
    else support.push({ kind: "plan", text: t("na.nextFrom", { time: leg.departure, from: leg.from }) });
    const minutes = here && leg.arrival ? sailMinutes(leg) : null;
    if (minutes != null) support.push({ kind: "trip", text: t("na.trip", { duration: durationText(minutes), time: leg.arrival }) });
  }
  if (base.cancelled && mode !== "outside") support.push({ kind: "cancelled", text: base.cancelled });

  const badge = badgeFor(state, view || {});
  const sr = [head, ...support.map((line) => line.text)].map((part) => String(part).replace(/[.\s]+$/, ""));
  const entur = view?.source === "entur";
  let source;
  if (state === "live") source = t(entur ? "na.srLiveEntur" : "na.srLive");
  else if (state === "stale" || state === "outside") source = t(entur ? "na.srLastEntur" : "na.srLastAis", { time: clockOf(view?.fixAt) });
  else if (state === "loading") source = t("na.srLoading");
  else if (state === "calc") source = t("na.srCalc");
  const sentence = `${sr.join(". ")}.${source ? ` ${source}` : ""}`;

  // Scenen: to kaier med ferja på linja. Ferja går alltid frå venstre mot høgre (frå-kaia til venstre).
  let scene = null;
  // På veg til ei kai: ferja på ei stipla linje mot kaia (ingen startkai, ingen framdrift).
  if (approach) scene = { kind: "line", from: "", to: approach.quay, x: 0.5, fill: "none", dashed: true, moving: false, marker: null, faded: false };
  else if (mode === "outside") scene = { kind: "outside" };
  else if (leg || base.quay) {
    let from = leg ? leg.from : base.quay;
    let to = leg ? leg.to : null;
    let x = 0;
    // Ved kai (AIS): ferja står på kaia ho ligg ved. Passar ikkje turen kortet viser planen for (t.d. ligg ved til-kaia,
    // eller ei heilt anna kai), står ferja på sin eigen ende, ikkje på startkaia til neste tur.
    const here = !underway && base.quay && state !== "unknown" ? quayPlace(base.quay) : null;
    if (here && leg) {
      if (here === quayPlace(leg.to)) x = 1;
      else if (here !== quayPlace(leg.from)) {
        from = base.quay;
        to = null;
      }
    }
    if (state === "unknown") {
      // Ukjend: ferja står ved siste kai vi såg ho ved, elles på midten («?»), ikkje der rutetabellen seier ho er.
      const seen = base.lastQuay ? quayPlace(base.lastQuay) : null;
      x = to ? (seen === quayPlace(to) ? 1 : seen === quayPlace(from) ? 0 : 0.5) : 0;
    } else if (underway) {
      x = Math.min(1, Math.max(0, view?.progress ?? 0));
    } else if (base.toQuay && !base.quay) {
      // På veg til startkaia: ferja står til venstre for kaia til ho er framme.
      x = -0.08;
    }
    scene = {
      kind: "line",
      from,
      to,
      x,
      fill: underway && state === "live" ? "solid" : underway && state === "stale" ? "soft" : underway && (state === "calc" || state === "loading") ? "striped" : "none",
      dashed: state !== "live",
      moving: underway && state === "live" && view?.speedKn != null,
      marker: state === "unknown" ? "?" : state === "calc" ? "≈" : null,
      faded: state === "unknown",
    };
  }
  // Lenkje til ferja i NAIS når posisjonen er frå AIS (MMSI-en til ferja kortet viser).
  // MMSI og namn kjem frå AIS-posisjonen til ferja kortet viser (MMSI-lista i innsamlaren), ikkje hardkoda her.
  // Fast aria-label, så sekundteljaren i merket ikkje blir lesen opp på nytt.
  const href = view?.source === "ais" ? naisVesselUrl(view.mmsi) : null;
  const nais = href ? { href, label: t("na.naisLink", { name: vesselTitle(view.vesselName) }) } : null;
  return { mode, state, tag, main, support, badge, scene, sentence, nais, label: t("na.label") };
}

/**
 * NAIS-lenkja i fotnoten når ferja er live frå AIS: MMSI og namn frå posisjonen (data), ikkje frå rutetabellen.
 * Slik følgjer lenkja den faktiske ferja (t.d. Geiranger på kombiruta). null utan fersk AIS-posisjon.
 */
export function liveNaisLink(live, nowMs = Date.now()) {
  const fix = bestFix(live?.crossing?.fixes || live?.fixes || [], nowMs);
  if (fix?.source !== "ais" || fixFreshness(fix, nowMs) === "unknown") return null;
  const href = naisVesselUrl(fix.vessel);
  return href ? { href, text: t("footnote.naisVessel", { name: vesselTitle(fix.name) }) } : null;
}
