/**
 * Detaljvindauget for éi avgang som rein data: tittel og avsnitt. Visninga gjer
 * avsnitta om til <p>, og avsnittet med `phone` til ei ringelenkje.
 */
import { t } from "../../assets/i18n.js?v=84";
import { clockMinutes, countdown, durationText, formatDateTime, hhmm, minutesToClock, nowMinutes } from "./time.js?v=84";
import { telHref } from "./live.js?v=84";

/**
 * Ein signaltur som er avlyst (Entur eller loggen) men som framleis ligg framfor oss i
 * dag, er «Avlyst», ikkje «Ikkje utført»: det har ikkje skjedd enno. Når avgangstida er
 * passert utan at ferja gjekk, blir han «Ikkje utført».
 */
export function cancelledAhead(leg, { today = false, past = false, now = nowMinutes() } = {}) {
  return Boolean(today && !past && leg?.departure && now < clockMinutes(leg.departure));
}

/**
 * Teksten i kolonna til høgre på ei avgangsrad, frå departureStateKey (tripstatus.js).
 * `opts` = { today, past, now } for å skilje «Avlyst» (framfor oss) frå «Ikkje utført».
 */
export function departureStateText(key, leg, opts = {}) {
  switch (key) {
    case "cancelled":
      return t("sailing.cancelled");
    case "notRunning":
      return cancelledAhead(leg, opts) ? t("signal.cancelledAhead") : t("signal.notRunning");
    case "unknown":
      return t("signal.unknown");
    case "gone":
      return t("gone");
    case "countdown":
      return countdown(leg.departure);
    default:
      return "";
  }
}

/**
 * Kva vindauget skal seie, frå tripStatus. Entur har ikkje tidspunkt for sjølve
 * ringinga: `observedAt` er når vi fyrst såg statusen, ikkje når nokon tinga.
 */
export function departureDetail(leg, status, phone = "") {
  return {
    phase: status.kind,
    booked: status.booked,
    skipped: status.skipped,
    cancelled: status.cancelled,
    signal: status.signal,
    deadline: status.deadline,
    seenSkip: status.seenSkip,
    skipReason: status.skipReason,
    minutesBefore: leg?.signal?.minutesBefore ?? null,
    phone: status.signal ? phone : "",
    observedAt: status.observedAt,
    skippedAt: status.skippedAt,
  };
}

/** Overfartstid etter rutetabellen i minutt (heil tid, over midnatt òg), eller null. */
export function crossingMinutes(leg) {
  if (!leg?.departure || !leg?.arrival) return null;
  const minutes = (clockMinutes(leg.arrival) - clockMinutes(leg.departure) + 1440) % 1440;
  return minutes > 0 && minutes < 240 ? Math.round(minutes) : null;
}

function statusText(leg, detail, opts) {
  if (detail.cancelled) return t("sailing.cancelled");
  if (detail.skipped) return cancelledAhead(leg, opts) ? t("signal.cancelledAhead") : t("signal.notRunning");
  if (detail.booked) return t("signal.booked");
  if (detail.phase === "sailed") return t("gone");
  return detail.signal ? t("signal.onRequest") : t("detail.regular");
}

/**
 * `opts` = { today, now, ferry }: `ferry` = { name, source, state } når ferja på turen er kjend (elles ingen ferjelinje). Ein avlyst signaltur som ikkje har gått enno, står som «Avlyst».
 * @returns {{ title: string, paragraphs: { className: string, text: string, phone?: string }[] }}
 */
export function departureDetailContent(leg, detail, opts = {}) {
  const p = (text, className = "detail-copy") => ({ className, text });
  const paragraphs = [];
  if (opts.ferry?.name) {
    const how = opts.ferry.source !== "ais" ? "" : opts.ferry.state === "live" ? ` (${t("detail.ferryAis")})` : ` (${t("detail.ferryLast")})`;
    paragraphs.push(p(`${t("detail.ferry", { name: opts.ferry.name })}${how}`, "detail-copy detail-ferry"));
  }
  if (leg.arrival) {
    const minutes = crossingMinutes(leg);
    const arrival = t("sailing.arrival", { time: hhmm(leg.arrival) });
    paragraphs.push(p(minutes ? `${arrival} · ${t("detail.crossing", { n: minutes })}` : arrival));
  }
  paragraphs.push(p(statusText(leg, detail, opts), "detail-status"));
  if (!detail.signal) {
    if (detail.cancelled) paragraphs.push(p(t("detail.cancelled")));
  } else {
    const deadline = detail.deadline != null ? minutesToClock(detail.deadline) : "";
    const lead = (detail.minutesBefore || 60) === 60 ? t("signal.leadHour") : durationText(detail.minutesBefore || 60);
    paragraphs.push(p(t("signal.how", { lead, time: deadline })));
    if (telHref(detail.phone)) {
      paragraphs.push({ className: "detail-copy", text: t("signal.callLink", { phone: detail.phone }), phone: detail.phone });
    }
    const caveat = p(t("signal.caveat"), "detail-caveat");
    if (detail.phase === "booked") {
      paragraphs.push(p(t("signal.bookedHow", { time: deadline })));
      if (detail.observedAt) paragraphs.push(p(t("signal.observed", { when: formatDateTime(detail.observedAt) })));
      paragraphs.push(caveat);
    } else if (detail.phase === "open") {
      paragraphs.push(p(t("signal.openHow", { time: deadline })), caveat);
    } else if (detail.phase === "skipped") {
      paragraphs.push(
        p(
          detail.seenSkip
            ? t("signal.skippedHow", { time: deadline })
            : detail.skipReason === "live"
              ? t("signal.skippedLiveHow")
              : t("signal.unknownHow", { time: deadline })
        )
      );
      const when = detail.skippedAt || detail.observedAt;
      if (detail.seenSkip && when) paragraphs.push(p(t("signal.skippedWhen", { when: formatDateTime(when) })));
    } else if (detail.phase === "sailed") {
      paragraphs.push(p(t("signal.sailedHow")));
    } else if (detail.phase === "unknown") {
      paragraphs.push(p(t("signal.unknownHow", { time: deadline })), caveat);
    }
  }
  return { title: t("detail.title", { time: hhmm(leg.departure), from: leg.from, to: leg.to }), paragraphs };
}
