/**
 * Trafikkmeldingar: tolking av Fjord1-tekst, vindauge, rutemodus og omlegging.
 * Rein logikk utan DOM, flytta uendra frå assets/app.js.
 */
import { t } from "../../assets/i18n.js?v=84";
import {
  NUMDATE_TOKEN,
  WEEKDAY_TOKEN,
  formatDateTime,
  fromOsloWall,
  isoFromUnix,
  osloIsoFromInstant,
  osloIsoFromMs,
  parseClockToken,
  parseNumDate,
} from "./time.js?v=84";
import { quayPlace } from "./legs.js?v=84";
import { vesselFromText } from "./live.js?v=84";

export const FJORD1_MESSAGES_PAGE = "https://www.fjord1.no/trafikkmeldingar";

export const NORMAL_RE = /normal drift/i;

export const CANCEL_RE = /innstilt|innstilling/i;

export const PARTIAL_CANCEL_RE =
  /følgjande avgangar|avgangar innstilt|avgang(?:en|ar)?\s+(?:kl\.?|klokka)/i;

export const KOMBI_RE = /kombinasjon|kombirute|kombinert rute/i;

export const DELAY_RE = /forsink/i;

export const CAPACITY_RE = /kapasitet|kapasistet|farleg last|farlig last/i;

export const HAS_1135_RE = /\b1135\b/;

export const HAS_1136_RE = /\b1136\b/;

export const ROUTE_1136_HINT_RE =
  /\b1136\b|trandal|standal|valderøy|store kalvøy|sæbø|skår/i;

export const LOCAL_ROUTE_RE = /\b(1136|1135|1049)\b/i;

export const LOCAL_PLACE_RE =
  /trandal|standal|sæbø|skår|store kalvøy|valderøy|bjørke|urke|festøy|hundeidvik/i;

/** GitHub-kopien er gammal når innhaldet ikkje er skrive på nytt. Då spør sida workeren. */
export const MESSAGES_STALE_MS = 8 * 60 * 1000;

/** Kor ofte appane spør etter nye meldingar når fana er synleg. */
export const MESSAGES_POLL_MS = 3 * 60 * 1000;

/** Publisert-tid og «gyldig til» frå Fjord1, med klokkeslett. */
export function messageTimeLines(msg) {
  const lines = [];
  const published = msg?.publishedAt || msg?.validFrom || null;
  if (published) {
    lines.push({
      iso: published,
      text: t("messages.published", { when: formatDateTime(published) }),
    });
  }
  if (msg?.validTo) {
    lines.push({
      iso: msg.validTo,
      text: t("messages.validTo", { when: formatDateTime(msg.validTo) }),
    });
  }
  return lines;
}

export function beforeModeFor(after, text) {
  if (after === "1136") return KOMBI_RE.test(text || "") ? "kombi" : "1135";
  return "1136";
}

export const HJORUNDFJORD_RE =
  /\b(?:1135|1136)\b|trandal|standal|sæbø|skår|lekne|valderøy|store kalvøy|kombinasjon|kombirute|kombinert rute/i;

export const ONLY_1049_RE = /\b1049\b|festøy|hundeidvik/i;

export function messageBlob(msg) {
  if (typeof msg === "string") return msg || "";
  return `${msg?.heading || ""} ${msg?.text || ""}`;
}

export function is1049Only(heading, text) {
  const blob = `${heading || ""} ${text || ""}`;
  return ONLY_1049_RE.test(blob) && !HJORUNDFJORD_RE.test(blob);
}

export function isPartialCancel(text) {
  const blob = text || "";
  if (!CANCEL_RE.test(blob) && !/kanseller/i.test(blob)) return false;
  return PARTIAL_CANCEL_RE.test(blob);
}

export function cancelledSailingsFromText(text) {
  const blob = String(text || "");
  const found = [];
  const groupRe =
    /((?:\d{1,2}[:.]?\d{2})(?:\s+og\s+(?:\d{1,2}[:.]?\d{2}))*)\s+(?:frå|fra)\s+([^\s,.;:]+)/gi;
  for (const group of blob.matchAll(groupRe)) {
    const quay = quayPlace(group[2]);
    if (!quay) continue;
    for (const clock of group[1].matchAll(/\b(\d{1,2})[:.](\d{2})\b|\b(\d{4})\b/g)) {
      const raw = clock[3] || `${clock[1]}:${clock[2]}`;
      const time = parseClockToken(raw);
      if (time) found.push({ time, from: quay });
    }
  }
  return found;
}

export function isRouteControl(msg) {
  if (!msg) return false;
  if (isPartialCancel(messageBlob(msg))) return false;
  if (msg.isRouteControl === true) return true;
  if (msg.isRouteControl === false) return false;
  const heading = msg.heading || "";
  const text = msg.text || "";
  if (is1049Only(heading, text)) return false;
  if (msg.isLocal === false) return false;
  if (msg.isLocal === true) return true;
  return HJORUNDFJORD_RE.test(`${heading} ${text}`);
}

export function windowFromText(text, published) {
  const blob = text || "";
  const ref = osloIsoFromInstant(published) || osloIsoFromMs();
  const range = blob.match(
    new RegExp(
      `(?:frå|fra)\\s+(?:rutestart\\s+)?(?:${WEEKDAY_TOKEN})?${NUMDATE_TOKEN}\\s+(?:til(?:\\s+og\\s+med)?|tom)\\s+(?:${WEEKDAY_TOKEN})?${NUMDATE_TOKEN}`,
      "i"
    )
  );
  if (range) {
    const start = parseNumDate(range[1], range[2], range[3], ref);
    const end = parseNumDate(range[4], range[5], range[6], ref);
    if (start || end) return { from: start, to: end };
  }
  const fromMatch = blob.match(
    new RegExp(`(?:frå|fra)\\s+(?:rutestart\\s+)?(?:${WEEKDAY_TOKEN})?${NUMDATE_TOKEN}`, "i")
  );
  const untilMatch = blob.match(
    new RegExp(`til\\s+og\\s+med\\s+(?:${WEEKDAY_TOKEN})?${NUMDATE_TOKEN}`, "i")
  );
  const start = fromMatch ? parseNumDate(fromMatch[1], fromMatch[2], fromMatch[3], ref) : null;
  const end = untilMatch
    ? parseNumDate(untilMatch[1], untilMatch[2], untilMatch[3], ref)
    : null;
  if (start || end) return { from: start, to: end };
  const alsoMatch = blob.match(
    new RegExp(`(?:også|òg)\\s+(?:på\\s+)?(?:${WEEKDAY_TOKEN})?${NUMDATE_TOKEN}`, "i")
  );
  if (alsoMatch) {
    const extra = parseNumDate(alsoMatch[1], alsoMatch[2], alsoMatch[3], ref);
    if (extra) return { from: null, to: extra };
  }
  return null;
}

export function activateAtFromText(text) {
  const match = String(text || "").match(
    /normal drift.{0,40}(?:frå|fra)\s+(?:klokka|kl\.?)\s*(?:ca\.?\s*)?(\d{1,2})[:.](\d{2})/is
  );
  return match ? parseClockToken(`${match[1]}:${match[2]}`) : null;
}

/** Skøyt berre når meldinga seier at tabellen byter («kombirute frå klokka»). */
export function switchFromText(text, afterMode = null) {
  const blob = text || "";
  const after = afterMode || modeFromText(blob);
  const kombiClock = blob.match(
    /(?:kombinasjon\w*|kombirute|kombinert rute)[\s\S]{0,80}(?:frå|fra)\s+(?:klokka|kl\.?)\s*(?:ca\.?\s*)?(\d{1,2})[:.](\d{2})/i
  );
  const performed = blob.match(
    /(?:utført|gjeld)\s+frå\s+(?:klokka\s+|kl\.?\s*)?(?:ca\.?\s*)?(\d{1,2})[:.](\d{2})/i
  );
  const match = kombiClock || performed;
  if (!match) return null;
  const time = parseClockToken(`${match[1]}:${match[2]}`);
  if (!time) return null;
  return {
    time,
    quay: null,
    before: beforeModeFor(after, blob),
    after,
    acute: null,
  };
}

export function modeFromText(text) {
  const blob = text || "";
  const hasNormal = NORMAL_RE.test(blob);
  const hasCancel = CANCEL_RE.test(blob);
  const hasKombi = KOMBI_RE.test(blob);
  const has1135 = HAS_1135_RE.test(blob);
  const has1136 = HAS_1136_RE.test(blob);
  if (hasNormal && hasCancel && !hasKombi) return "1136";
  if (hasKombi || (hasCancel && has1135 && has1136)) return "kombi";
  if (hasCancel && has1136 && !has1135) {
    return isPartialCancel(blob) ? "1136" : "1135";
  }
  return "1136";
}

export function messageMode(msg) {
  if (!msg) return "1136";
  if (isPartialCancel(messageBlob(msg))) return "1136";
  return msg.routeMode || modeFromText(messageBlob(msg));
}

export function publishedMs(msg) {
  const ms = Date.parse(msg?.publishedAt || msg?.validFrom || "");
  return Number.isFinite(ms) ? ms : 0;
}

export function textRouteWindow(msg) {
  if (!msg) return null;
  return (
    msg.routeWindow ||
    windowFromText(messageBlob(msg), msg.publishedAt || msg.validFrom)
  );
}

export function textWindowCoversToday(msg, now = Date.now()) {
  const win = textRouteWindow(msg);
  return Boolean(win?.to && osloIsoFromMs(now) <= win.to);
}

/** Hald meldinga ut CMS-dagen i Oslo, éin time etter validTo, eller ut tekstvindauget. */
export function messageIsHeld(msg, now = Date.now()) {
  if (!msg?.validTo) return true;
  const until = Date.parse(msg.validTo);
  if (Number.isFinite(until) && until >= now - 60 * 60 * 1000) return true;
  const validDay = osloIsoFromInstant(msg.validTo);
  if (validDay && osloIsoFromMs(now) <= validDay) return true;
  return textWindowCoversToday(msg, now);
}

/** Behald berre når vi veit at meldinga framleis gjeld etter at Fjord1 droppa ho. */
export function messageShouldBeRetained(msg, now = Date.now()) {
  if (!msg) return false;
  if (textWindowCoversToday(msg, now)) return true;
  if (!msg.validTo) return false;
  const until = Date.parse(msg.validTo);
  if (Number.isFinite(until) && until >= now - 60 * 60 * 1000) return true;
  const validDay = osloIsoFromInstant(msg.validTo);
  return Boolean(validDay && osloIsoFromMs(now) <= validDay);
}

export function retainHeldMessages(fresh, previous, now = Date.now()) {
  const byKey = new Map();
  for (const msg of previous || []) {
    if (messageShouldBeRetained(msg, now)) byKey.set(messageMergeKey(msg), msg);
  }
  for (const msg of fresh || []) byKey.set(messageMergeKey(msg), msg);
  return [...byKey.values()].sort((a, b) => publishedMs(b) - publishedMs(a));
}

export function messageWindow(msg) {
  const textWin = textRouteWindow(msg);
  const fromDate =
    textWin?.from || osloIsoFromInstant(msg.validFrom) || osloIsoFromInstant(msg.publishedAt);
  const toDate = textWin?.to || osloIsoFromInstant(msg.validTo);
  return { from: fromDate || null, to: toDate || null };
}

export function messageAppliesToDate(msg, date, now = Date.now()) {
  if (!isRouteControl(msg)) return false;
  const today = osloIsoFromMs(now);
  if (date >= today && !messageIsHeld(msg, now)) return false;
  const win = messageWindow(msg);
  if (win.from && date < win.from) return false;
  if (win.to && date > win.to) return false;
  return true;
}

export function controllingMessages(messages, date, now = Date.now()) {
  return validMessages(messages || [], now)
    .filter((msg) => messageAppliesToDate(msg, date, now))
    .sort((a, b) => publishedMs(b) - publishedMs(a));
}

export function firstDayOf(msg) {
  const win = messageWindow(msg);
  return win.from || osloIsoFromInstant(msg.publishedAt) || osloIsoFromInstant(msg.validFrom);
}

export function resolveRoutePlan(messages, now = Date.now(), date = osloIsoFromMs(now)) {
  const matches = controllingMessages(messages, date, now);
  const latest = matches[0];
  if (!latest) return { mode: "1136", switch: null, message: null };
  const mode = messageMode(latest);
  const blob = messageBlob(latest);
  let parsed = latest.routeSwitch || switchFromText(blob, mode);
  const activateAt = latest.activateAt || activateAtFromText(blob);
  if (!parsed && activateAt && date === firstDayOf(latest)) {
    const previous = matches[1];
    const before = previous ? messageMode(previous) : null;
    if (before && before !== mode) {
      parsed = { time: activateAt, quay: null, before, after: mode, acute: null };
    }
  }
  return { mode, switch: parsed, message: latest };
}

export function driftNeedsOperationalTable(resolved, parsed) {
  const mode = resolved?.mode || "1136";
  if (mode === "kombi" || mode === "1135") return true;
  if (!parsed) return false;
  return (
    parsed.after === "kombi" ||
    parsed.before === "kombi" ||
    parsed.after === "1135" ||
    parsed.before === "1135"
  );
}

export function parseFjord1Published(dateStr, fallbackTs) {
  const raw = String(dateStr || "").trim();
  const match = raw.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(?:kl\.?\s*)?(\d{1,2})[:.](\d{2})(?::(\d{2}))?)?/i
  );
  if (match) {
    const iso = fromOsloWall(
      Number(match[3]),
      Number(match[2]),
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
    if (iso) return iso;
  }
  return isoFromUnix(fallbackTs);
}

export function classifyMessage(text) {
  if (!text) return "info";
  const hasNormal = NORMAL_RE.test(text);
  const hasCancel = CANCEL_RE.test(text);
  const hasDelay = DELAY_RE.test(text);
  const hasCapacity = CAPACITY_RE.test(text);
  if (hasCancel && hasNormal) return hasDelay ? "delay" : "normal";
  if (hasCancel) return "cancelled";
  if (hasDelay) return "delay";
  if (hasNormal) return "normal";
  if (hasCapacity) return "capacity";
  return "info";
}

export function isRoute1136Message(heading, text, connectionNumber) {
  if (Number(connectionNumber) === CONN_1136) return true;
  return ROUTE_1136_HINT_RE.test(`${heading || ""} ${text || ""}`);
}

export function isLocalMessage(heading, text, connectionNumber) {
  if (isRoute1136Message(heading, text, connectionNumber)) return true;
  const blob = `${heading || ""} ${text || ""}`;
  return LOCAL_ROUTE_RE.test(blob) || LOCAL_PLACE_RE.test(blob);
}

export function compactMessageText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function messageMergeKey(msg) {
  return `${compactMessageText(msg?.heading)}|${compactMessageText(msg?.text)}`;
}

export function liveMessageId(heading, text) {
  const key = messageMergeKey({ heading, text });
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return `live:${(hash >>> 0).toString(16)}`;
}

export function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function normalizeFjord1Node(node) {
  const heading = compactMessageText(node?.heading);
  const text = compactMessageText(node?.content ?? node?.text);
  const connection = node?.connectionNumber ?? null;
  const validFromTs = node?.validFrom?.timestamp ?? node?.validFrom;
  const validToTs = node?.validTo?.timestamp ?? node?.validTo;
  const published = parseFjord1Published(node?.date || "", validFromTs);
  const blob = `${heading} ${text}`;
  const local = isLocalMessage(heading, text, connection);
  return {
    id: node?.id || liveMessageId(heading, text),
    heading,
    text,
    publishedAt: published,
    validFrom: isoFromUnix(validFromTs),
    validTo: isoFromUnix(validToTs),
    countyNumber: node?.countyNumber ?? null,
    connectionNumber: connection,
    important: Boolean(node?.importantMessage || node?.important),
    severity: classifyMessage(text),
    isRoute1136: isRoute1136Message(heading, text, connection),
    isLocal: local,
    isRouteControl:
      !isPartialCancel(blob) &&
      !is1049Only(heading, text) &&
      (local || HJORUNDFJORD_RE.test(blob)),
    routeMode: modeFromText(blob),
    routeWindow: windowFromText(blob, published),
    activateAt: activateAtFromText(blob),
    vessel: vesselFromText(blob),
    routeSwitch: switchFromText(blob),
  };
}

export function parseFjord1TrafficHtml(html) {
  const source = decodeHtmlEntities(html || "");
  const found = [];
  const blockRe =
    /fjord1-alert__header">\s*<span class="ezstring-field">([^<]*)<\/span>[\s\S]*?fjord1-alert__content">\s*<span class="ezstring-field">([^<]*)<\/span>[\s\S]*?fjord1-alert__footer">\s*([^<]+)/g;
  for (const match of source.matchAll(blockRe)) {
    found.push(
      normalizeFjord1Node({
        heading: match[1],
        content: match[2],
        date: compactMessageText(match[3]),
      })
    );
  }
  if (found.length) return found;
  for (const chunk of source.split(/\n{2,}/)) {
    const line = compactMessageText(chunk);
    const match = line.match(/^Rute\s+\d+\s+(.+?):\s*(.+)$/i);
    if (!match) continue;
    found.push(
      normalizeFjord1Node({
        heading: match[1],
        content: line,
      })
    );
  }
  return found;
}

export function fjord1Payload(messages, { fetchedAt = null, live = true, complete = false } = {}) {
  return {
    source: FJORD1_MESSAGES_PAGE,
    fetchedAt: fetchedAt || new Date().toISOString(),
    fetchedLive: live,
    complete,
    messages,
  };
}

export function messagesAreStale(payload, now = Date.now()) {
  const ms = Date.parse(payload?.fetchedAt || "");
  if (!Number.isFinite(ms)) return true;
  return now - ms > MESSAGES_STALE_MS;
}

export function mergeMessagePayloads(base, live, now = Date.now()) {
  if (!live?.messages?.length) return base || null;
  if (!base?.messages?.length) return live;
  if (live.complete) {
    return {
      source: live.source || base.source,
      fetchedAt: live.fetchedAt || base.fetchedAt,
      fetchedLive: Boolean(live.fetchedLive),
      complete: true,
      messages: retainHeldMessages(live.messages, base.messages, now),
    };
  }
  const byKey = new Map();
  for (const msg of base.messages) byKey.set(messageMergeKey(msg), msg);
  let added = false;
  for (const msg of live.messages) {
    const key = messageMergeKey(msg);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, msg);
      added = true;
      continue;
    }
    if (publishedMs(msg) > publishedMs(existing)) {
      byKey.set(key, { ...existing, ...msg, id: existing.id || msg.id });
      added = true;
    }
  }
  if (!added && !live.fetchedLive) return base;
  const messages = [...byKey.values()].sort((a, b) => publishedMs(b) - publishedMs(a));
  return {
    source: live.source || base.source,
    fetchedAt: live.fetchedAt || base.fetchedAt,
    fetchedLive: Boolean(live.fetchedLive || added),
    messages,
  };
}

export function messagesFingerprint(payload) {
  const messages = payload?.messages || [];
  return JSON.stringify(
    messages.map((msg) => [
      msg.id || "",
      msg.text || "",
      msg.validTo || "",
      msg.severity || "",
      msg.routeMode || "",
      msg.routeSwitch || null,
      msg.activateAt || null,
    ])
  );
}

export function validMessages(messages, now = Date.now()) {
  return (messages || []).filter((msg) => messageIsHeld(msg, now));
}

export function routeNameFlags(msg) {
  const blob = messageBlob(msg);
  const heading = String(msg?.heading || "");
  const conn = Number(msg?.connectionNumber);
  return {
    named1136:
      conn === CONN_1136 ||
      /\b1136\b/.test(blob) ||
      /standal|trandal|valderøy|store kalvøy/i.test(heading),
    named1135: conn === CONN_1135 || /\b1135\b/.test(blob) || /lekne/i.test(heading),
    // 1049 Festøya–Hundeidvik: berre ordlyd (Fjord1-sambandsnummeret er ikkje stadfesta). Staden i overskrifta ELLER «1049» i teksten.
    named1049: /\b1049\b/.test(blob) || /festøy|hundeidvik/i.test(heading),
  };
}

export function filterMessageKey(messages) {
  return messages.map((msg) => msg.id || messageMergeKey(msg)).join("\n");
}

export const CONN_1136 = 132;

export const CONN_1135 = 134;

// --- Panelet: filter, rekkjefølgje og henting -------------------------------------------

/** CORS-JSON frå cloudflare/trafikkmeldinger/. Må vere lik MESSAGES_API_URL der. */
export const FJORD1_MESSAGES_API = "https://fergeruter-trafikkmeldinger.fergeruter-teitrand.workers.dev/";
/** Siste utveg om workeren feilar. Fjord1-sida har ikkje CORS. */
export const FJORD1_HTML_READER = `https://r.jina.ai/${FJORD1_MESSAGES_PAGE}`;

export const SEVERITY_RANK = { cancelled: 0, delay: 1, capacity: 2, info: 3, normal: 4 };

export function matchesChosenRouteNotice(msg, route) {
  const flags = routeNameFlags(msg);
  if (route === "1049") return flags.named1049;
  return route === "1135" ? flags.named1135 : flags.named1136;
}

export function messageRouteScore(msg, route) {
  const { named1136, named1135, named1049 } = routeNameFlags(msg);
  const kombi = msg?.routeMode === "kombi" || KOMBI_RE.test(messageBlob(msg));
  const [own, other] =
    route === "1136" ? [named1136, named1135]
    : route === "1135" ? [named1135, named1136]
    : route === "1049" ? [named1049, named1136 || named1135]
    : [null, null];
  if (own === null) return 3;
  if (own && !other) return 0;
  if (own) return 1;
  if (kombi) return 2;
  return 3;
}

export function sortMessagesForRoute(messages, route) {
  return [...messages].sort((a, b) => {
    const byRoute = messageRouteScore(a, route) - messageRouteScore(b, route);
    if (byRoute) return byRoute;
    const byPublished = publishedMs(b) - publishedMs(a);
    if (byPublished) return byPublished;
    return (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
  });
}

/** «local» = Hjørundfjorden, «route» = meldingar som nemner det valde sambandet. */
export function messagesForFilter(messages, filter, route) {
  if (filter === "route") return sortMessagesForRoute(messages.filter((msg) => matchesChosenRouteNotice(msg, route)), route);
  return sortMessagesForRoute(messages.filter((msg) => msg.isLocal), route);
}

/** Filterknappane, eller ingen når båe filtera gjev same meldingar. */
export function usefulMessageFilters(messages, route) {
  const local = filterMessageKey(messagesForFilter(messages, "local", route));
  const routeIds = filterMessageKey(messagesForFilter(messages, "route", route));
  return routeIds === local ? [] : ["local", "route"];
}

/**
 * Det panelet viser: `hidden` utan meldingar i området, elles filterknappane, det
 * gjeldande filteret (fell tilbake til «local»), dei filtrerte meldingane og meta-teksten.
 */
export function messagesPanel(payload, filter, route, now = Date.now()) {
  if (!payload) return { hidden: true, filters: [], filter: "local", messages: [], meta: "" };
  const all = validMessages(payload.messages || [], now);
  if (!all.some((msg) => msg.isLocal)) return { hidden: true, filters: [], filter: "local", messages: [], meta: "" };
  const filters = usefulMessageFilters(all, route);
  const active = filters.includes(filter) ? filter : "local";
  return {
    hidden: false,
    filters,
    filter: active,
    messages: messagesForFilter(all, active, route),
    meta: t(payload.fetchedLive ? "messages.fetchedLive" : "messages.fetched", { when: formatDateTime(payload.fetchedAt) }),
  };
}

export async function fetchWithTimeout(fetchImpl, url, options = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFjord1Api(fetchImpl) {
  const response = await fetchWithTimeout(
    fetchImpl,
    FJORD1_MESSAGES_API,
    { headers: { Accept: "application/json" }, cache: "no-store" },
    5000
  );
  if (!response.ok) throw new Error(response.statusText || String(response.status));
  const body = await response.json();
  if (!Array.isArray(body?.messages)) throw new Error("Uventa svar frå trafikkmelding-API");
  const messages = body.messages.filter(Boolean).map((node) => normalizeFjord1Node(node));
  return fjord1Payload(messages, { fetchedAt: body.fetchedAt || null, complete: true });
}

async function fetchFjord1Html(fetchImpl) {
  const response = await fetchWithTimeout(fetchImpl, FJORD1_HTML_READER, {
    headers: { "X-Return-Format": "html", Accept: "text/html,text/plain" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.statusText);
  const messages = parseFjord1TrafficHtml(await response.text());
  if (!messages.length) throw new Error("Ingen Fjord1-meldingar i HTML");
  return fjord1Payload(messages);
}

/** Direkte frå Fjord1: workeren fyrst, så HTML-sida via lesaren. */
export async function fetchFjord1Messages(fetchImpl) {
  try {
    return await fetchFjord1Api(fetchImpl);
  } catch {
    return fetchFjord1Html(fetchImpl);
  }
}

/** Nytt svar, med meldingar vi framleis held på frå `previous` (t.d. omleggingar). */
export function withHeldMessages(payload, previous, now = Date.now()) {
  if (!payload || !previous?.length) return payload;
  return { ...payload, messages: retainHeldMessages(payload.messages, previous, now) };
}

/**
 * Neste meldingstilstand når eit svar kjem: same objekt om ingenting er endra (så
 * ingenting blir teikna på nytt), elles svaret med meldingar vi held på frå før.
 * Er meldingane like, men hentetida ny, får det gamle objektet ny `fetchedAt` og
 * `fetchedLive`, så «Sist henta» i panelet ikkje blir ståande gammal.
 */
export function nextMessages(previous, incoming, now = Date.now()) {
  if (!incoming) return previous;
  const payload = withHeldMessages(incoming, previous?.messages, now);
  if (!previous || messagesFingerprint(previous) !== messagesFingerprint(payload)) return payload;
  if (previous.fetchedAt === payload.fetchedAt && previous.fetchedLive === payload.fetchedLive) return previous;
  return { ...previous, fetchedAt: payload.fetchedAt, fetchedLive: payload.fetchedLive };
}
