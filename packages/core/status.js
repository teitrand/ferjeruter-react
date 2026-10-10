/**
 * Ferjestatus på tidslinja: kvar ferja er no, liggetid, tomkøyring og framdrift.
 * Rein logikk utan DOM og utan global tilstand. Det appen veit, kjem inn som `ev` og `view`.
 */
import { t } from "../../assets/i18n.js?v=84";
import { clockMinutes, durationText, hhmm } from "./time.js?v=84";
import { LAYOVER_MIN_MINUTES, legIndex, quayPlace, sameLeg } from "./legs.js?v=84";
import { isLiveFresh, leftOrigin, legForLive } from "./live.js?v=84";
import { firstKnownQuay } from "./plan.js?v=84";
import { signalReachedDestination, signalSkippedStatus } from "./signal.js?v=84";
import { runningLegs, signalVerdict } from "./tripstatus.js?v=84";

export const HOME_QUAY = "Standal";

export function delayApplies(live, monitored) {
  if (!live || !(live.delayMinutes >= 1)) return false;
  if (monitored?.signal && leftOrigin(live, monitored) !== true) return false;
  return true;
}

export function homeQuay(legs) {
  return legs[0]?.from || HOME_QUAY;
}

/** Valderøya og Store Kalvøy. Tomtur til eller frå Hjørundfjorden står ikkje i tabellen. */
export const OUTER_QUAYS = new Set(["Valderøya", "Store Kalvøy"]);

/**
 * Tomtur Valderøya/Store Kalvøy ↔ Hjørundfjorden.
 * AIS for M/F Kvernes (MMSI 257297400, feb–mars 2026) viser om lag 110–125 min
 * (målt 109, 110, 114, 117, 117, 120, 125, 126 og 134; nattur 114 min).
 * Fast 120 min, så «på veg» ikkje fyller heile holet. Resten ligg ferja til kai.
 */
export const OUTER_DEADHEAD_MINUTES = 120;

/**
 * Ferja går utan passasjerar berre til og frå Valderøya (der er det ikkje lov å gå om bord). Alle andre turar og
 * tomturar, også mellom Standal og Trandal, skal ha vanleg ordlyd. Dette gjeld berre ordlyden; tida for tomtur
 * ligg i outerDeadheadMinutes.
 */
export const NO_PASSENGER_QUAY = "Valderøya";

export function isNoPassengerTrip(fromQuay, toQuay) {
  const from = quayPlace(fromQuay);
  const to = quayPlace(toQuay);
  return from === NO_PASSENGER_QUAY || to === NO_PASSENGER_QUAY;
}

/** Statuslinje for ferja på veg tilbake til heimkaia etter siste tur: «utan passasjerar» berre ved Valderøya. */
function backHomeWording(lastTo, home) {
  if (isNoPassengerTrip(lastTo, home)) {
    return { short: t("status.backEmpty", { home }), text: t("status.backEmptyText", { to: lastTo, home }) };
  }
  return { short: t("status.backHome", { home }), text: t("status.backHomeText", { to: lastTo, home }) };
}

export function isOuterQuay(quay) {
  return OUTER_QUAYS.has(quayPlace(quay));
}

/** Fast seglingstid når eine kaia er ytre (Valderøya/Store Kalvøy) og den andre ikkje. */
export function outerDeadheadMinutes(fromQuay, toQuay) {
  const from = quayPlace(fromQuay);
  const to = quayPlace(toQuay);
  if (!from || !to || from === to) return null;
  if (isOuterQuay(from) === isOuterQuay(to)) return null;
  return OUTER_DEADHEAD_MINUTES;
}

/** Kortaste planlagde overfarten mellom to kaier. Tomturen tek ikkje heile holet. */
export function crossingMinutes(allLegs, fromQuay, toQuay) {
  const from = quayPlace(fromQuay);
  const to = quayPlace(toQuay);
  if (!from || !to || from === to) return null;
  let shortest = null;
  for (const leg of allLegs || []) {
    if (quayPlace(leg.from) !== from || quayPlace(leg.to) !== to) continue;
    if (!leg.departure || !leg.arrival) continue;
    const minutes = clockMinutes(leg.arrival) - clockMinutes(leg.departure);
    if (minutes > 0 && (shortest == null || minutes < shortest)) shortest = minutes;
  }
  return shortest ?? outerDeadheadMinutes(from, to);
}

/** Tidspunkt for ei VM-aktivitet: RecordedAtTime, elles ValidUntilTime. */
export function activityTime(activity) {
  const recorded = Date.parse(activity?.RecordedAtTime);
  if (Number.isFinite(recorded)) return recorded;
  const until = Date.parse(activity?.ValidUntilTime);
  return Number.isFinite(until) ? until : -Infinity;
}

export function delayBit(minutes) {
  if (minutes >= 1) return t("delay.about", { n: minutes });
  return "";
}

export function statusProgress(from, until, now) {
  if (!Number.isFinite(from) || !Number.isFinite(until) || !Number.isFinite(now)) return null;
  const span = until - from;
  if (span <= 0) return null;
  return Math.min(1, Math.max(0, (now - from) / span));
}

export function withSpan(status, from, until, now) {
  const progress = statusProgress(from, until, now);
  if (progress == null) return status;
  return { ...status, from, until, progress };
}

export function withSanntid(base, live) {
  const delay = delayBit(live.delayMinutes);
  const short = delay ? `${base}, ${delay}` : base;
  return {
    live: true,
    short,
    text: t("live.fromEntur", { text: short }),
  };
}

export function isEmptyReposition(fromQuay, toQuay) {
  return outerDeadheadMinutes(fromQuay, toQuay) != null;
}

export function overnightStatus(last, home, now) {
  const deadhead = outerDeadheadMinutes(last.to, home);
  if (deadhead == null) {
    const quay = last.to;
    return {
      at: 1441,
      short: t("status.doneAt", { home: quay }),
      text: t("status.doneAtPeriod", { home: quay }),
    };
  }
  const since = now - clockMinutes(last.arrival);
  if (since < deadhead) {
    const start = clockMinutes(last.arrival);
    return withSpan(
      {
        at: start + 0.5,
        underway: true,
        ...backHomeWording(last.to, home),
      },
      start,
      start + deadhead,
      now
    );
  }
  return {
    at: 1441,
    short: t("status.mooredAt", { quay: home }),
    text: t("status.doneMoored", { home }),
  };
}

export function returnHomeStatus(last, back, now) {
  const arrived = clockMinutes(last.arrival);
  const leaves = clockMinutes(back.departure);
  const home = back.to;
  if (now < leaves) {
    return withSpan({ at: arrived + 0.5, text: t("status.mooredAt", { quay: last.to }) }, arrived, leaves, now);
  }
  const ends = clockMinutes(back.arrival || back.departure);
  if (now < ends) {
    return withSpan(
      {
        at: leaves + 0.5,
        underway: true,
        ...backHomeWording(last.to, home),
      },
      leaves,
      ends,
      now
    );
  }
  return { at: 1441, short: t("status.doneAt", { home }), text: t("status.doneAtPeriod", { home }) };
}

export function isVisibleDeparture(leg) {
  return !leg.hideDeparture;
}

export function layoverAfter(leg, next) {
  if (!next || !leg?.arrival || !next.departure) return null;
  if (leg.to !== next.from) return null;
  const minutes = clockMinutes(next.departure) - clockMinutes(leg.arrival);
  if (minutes < LAYOVER_MIN_MINUTES) return null;
  return {
    quay: leg.to,
    minutes,
    from: leg.arrival,
    until: next.departure,
  };
}

export const EVENT_SEQ = { arr: 0, split: 1, transfer: 2, layover: 3, wait: 3, dep: 4, status: 5 };

export function compareTimelineEvents(a, b) {
  const seq = (event) => EVENT_SEQ[event.kind] ?? 0;
  return a.at - b.at || seq(a) - seq(b);
}

/**
 * `view` gjev det statusen treng å vite om rutetabellen den valde dagen:
 * - `combined`: éi ferje køyrer begge sambanda (kombirute eller omlegging)
 * - `catalog`: alle turane i tabellen, for å finne overfartstida ved tomkøyring
 * - `quays`: kjende kaiar, for å kjenne att kaia i sanntidsdata
 */
export function liveStatus(live, quays) {
  if (!isLiveFresh(live)) return null;
  const dest = firstKnownQuay(live.destination, quays);
  const base = dest ? t("status.underwayTo", { dest }) : t("status.onSchedule");
  return { underway: true, ...withSanntid(base, live) };
}

/** Kvar ferja er akkurat no, rekna ut frå rutetabellen. */
export function ferryStatus(legs, now, allLegs, view) {
  if (!legs.length) return null;
  const first = legs[0];
  const last = legs[legs.length - 1];
  const home = homeQuay(legs);
  const catalog = allLegs || view.catalog || legs;

  if (now < clockMinutes(first.departure)) {
    return {
      at: clockMinutes(first.departure) - 1,
      short: t("status.mooredAt", { quay: first.from }),
      text: t("status.firstDeparture", { from: first.from, time: hhmm(first.departure) }),
    };
  }
  if (now >= clockMinutes(last.arrival)) {
    if (view.combined || last.to === home) {
      const quay = last.to;
      return {
        at: 1441,
        short: t("status.doneAt", { home: quay }),
        text: t("status.doneAtPeriod", { home: quay }),
      };
    }
    return overnightStatus(last, home, now);
  }

  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    if (now >= clockMinutes(leg.departure) && now < clockMinutes(leg.arrival)) {
      const start = clockMinutes(leg.departure);
      const end = clockMinutes(leg.arrival);
      return withSpan(
        {
          at: start + 0.5,
          underway: true,
          text: t("status.underwayTo", { dest: leg.to }),
        },
        start,
        end,
        now
      );
    }
    const next = legs[i + 1];
    if (next && now >= clockMinutes(leg.arrival) && now < clockMinutes(next.departure)) {
      const start = clockMinutes(leg.arrival);
      const end = clockMinutes(next.departure);
      const moving = !view.combined && isEmptyReposition(leg.to, next.from);
      if (moving) {
        const sail = crossingMinutes(catalog, leg.to, next.from);
        const sailEnd = sail != null && sail < end - start ? start + sail : end;
        if (now >= sailEnd && sailEnd < end) {
          return withSpan(
            {
              at: sailEnd + 0.5,
              text: t("status.mooredAt", { quay: next.from }),
            },
            sailEnd,
            end,
            now
          );
        }
        return withSpan(
          {
            at: start + 0.5,
            underway: true,
            text: isNoPassengerTrip(leg.to, next.from)
              ? t("status.repositionTo", { quay: next.from })
              : t("status.underwayTo", { dest: next.from }),
          },
          start,
          sailEnd,
          now
        );
      }
      const stay = layoverAfter(leg, next);
      if (stay) {
        return withSpan(
          {
            at: start + 0.5,
            layover: true,
            short: t("status.mooredAt", { quay: stay.quay }),
            text: t("status.layoverAt", {
              quay: stay.quay,
              duration: durationText(stay.minutes),
              time: hhmm(stay.until),
            }),
          },
          start,
          end,
          now
        );
      }
      return withSpan(
        {
          at: start + 0.5,
          text: t("status.mooredAt", { quay: leg.to }),
        },
        start,
        end,
        now
      );
    }
  }
  return null;
}

/** Same kai-tekst som tabellen bruker mellom ankomst og neste avgang. */
export function signalArrivedQuayStatus(legs, leg, now, view) {
  const quay = quayPlace(leg?.to) || leg?.to || "";
  const list = Array.isArray(legs) && legs.length ? legs : [leg];
  const withLeg = list.some((item) => sameLeg(item, leg)) ? list : [...list, leg];
  const arrivalAt = leg?.arrival ? clockMinutes(leg.arrival) : now;
  const when = Math.max(now, arrivalAt);
  const status = ferryStatus(withLeg, when, withLeg, view);
  if (status) return status;
  return {
    at: when,
    short: t("status.mooredAt", { quay }),
    text: t("status.mooredAt", { quay }),
  };
}

export function signalRunningStatus(leg, live, now, legs, view) {
  if (signalReachedDestination(leg, live, now)) {
    const arrived = signalArrivedQuayStatus(legs, leg, now, view);
    if (arrived) return arrived;
  }
  const dest = firstKnownQuay(live.destination, view.quays) || leg.to;
  const base = t("status.underwayTo", { dest });
  const start = clockMinutes(leg.departure);
  const end = leg.arrival ? clockMinutes(leg.arrival) : start + 1;
  return withSpan(
    {
      at: start + 0.5,
      underway: true,
      signal: "running",
      ...withSanntid(base, live),
    },
    start,
    end,
    now
  );
}

/**
 * Ferja ligg over natta på heimkaia. Er turen heim avlyst, går ho dit likevel, tom
 * (8. oktober: 20:20 Trandal–Standal var avlyst hos Entur, men ferja gjekk).
 * Returnerer turen heim når dagen etter siste køyrde tur elles ville slutta på feil kai.
 */
export function cancelledReturnHome(legs, running, view) {
  if (view.combined || !legs?.length || !running?.length) return null;
  const home = quayPlace(homeQuay(legs));
  const last = running[running.length - 1];
  const plannedLast = legs[legs.length - 1];
  if (sameLeg(plannedLast, last) || quayPlace(plannedLast.to) !== home) return null;
  if (quayPlace(last.to) === home) return null;
  const at = legIndex(legs, last);
  return (
    legs
      .slice(at + 1)
      .find((leg) => quayPlace(leg.from) === quayPlace(last.to) && quayPlace(leg.to) === home) || null
  );
}

/** Statuslinja for i dag: rutetabellen, retta med bevis og fersk sanntid. */
export function currentStatus(legs, now, ev, view) {
  const runningNow = runningLegs(legs, now, ev);
  let planned = ferryStatus(runningNow, now, null, view);
  const back = cancelledReturnHome(legs, runningNow, view);
  if (back && now >= clockMinutes(runningNow[runningNow.length - 1].arrival)) {
    planned = returnHomeStatus(runningNow[runningNow.length - 1], back, now);
  }
  const live = isLiveFresh(ev.live) ? ev.live : null;
  if (!live) return planned;
  const monitored = legForLive(legs, live);
  if (monitored?.signal && leftOrigin(live, monitored) === true) {
    const running = runningLegs(legs, now, ev);
    if (signalReachedDestination(monitored, live, now)) {
      const arrived = signalArrivedQuayStatus(running, monitored, now, view);
      if (arrived) return arrived;
    }
    return signalRunningStatus(monitored, live, now, running, view);
  }
  if (
    monitored?.signal &&
    leftOrigin(live, monitored) === false &&
    now >= clockMinutes(monitored.departure)
  ) {
    // «Ikkje utført» berre med bevis. Innan slingringsmonnet kan ferja berre vere forseinka.
    if (signalVerdict(monitored, live, now, legs, ev) === "skipped") {
      return signalSkippedStatus(monitored, now);
    }
    return { at: now, ...withSanntid(t("status.mooredAt", { quay: monitored.from }), live) };
  }
  if (planned && delayApplies(live, monitored)) {
    const base = (planned.short || planned.text || "").replace(/\.$/, "");
    return { ...planned, ...withSanntid(base, live) };
  }
  if (planned) return planned;
  return liveStatus(live, view.quays);
}
