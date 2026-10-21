/**
 * Fjord1-trafikkmeldingar frå innsamlaren til workeren (POST /v1/trafikkmeldinger), same mønster som AIS-push:
 * VM-en er ikkje nåbar frå internett, så innsamlaren hentar sjølv og skubbar til workeren. Kvart 2. minutt.
 * Hentinga er den same som i cloudflare/trafikkmeldinger (Fjord1 REST-viewet), så appen får same form.
 * Tolkinga her er berre til logg/status (kor mange lokale); appen tolkar sjølv med packages/core/messages.js.
 */
import { fetchMessages } from "../../cloudflare/trafikkmeldinger/src/index.js";
import { isLocalMessage } from "../../packages/core/index.js";
import { createBackoff, retryAfterMs } from "./backoff.js";

export const MESSAGES_EVERY_MS = 2 * 60000;

/**
 * @param {{ post: (path: string, body: object) => Promise<Response>, enabled: boolean }} sender
 */
export function createMessagesPusher(sender, { fetchImpl = fetch, now = Date.now, log = () => {} } = {}) {
  const backoff = createBackoff();
  const state = { enabled: Boolean(sender?.enabled), fetched: 0, sent: 0, failed: 0, local: 0, count: 0, lastFetchedAt: null, lastSentAt: null, lastError: null };
  return {
    state,
    /** Hent frå Fjord1 og send. Feilar éin del, prøver vi att ved neste tikk (med backoff ved feil mot workeren). */
    async tick() {
      if (!state.enabled || now() < backoff.blockedUntil) return false;
      let res = null;
      try {
        const messages = await fetchMessages({ fetchImpl });
        const fetchedAt = new Date(now()).toISOString();
        state.fetched += 1;
        state.count = messages.length;
        state.local = messages.filter((m) => isLocalMessage(m.heading, m.content, m.connectionNumber)).length;
        state.lastFetchedAt = fetchedAt;
        res = await sender.post("/v1/trafikkmeldinger", { schema: 1, fetchedAt, messages });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        backoff.succeed();
        state.sent += 1;
        state.lastSentAt = fetchedAt;
        state.lastError = null;
        return true;
      } catch (error) {
        backoff.fail(now(), retryAfterMs(res?.headers?.get?.("retry-after"), now()));
        state.failed += 1;
        state.lastError = String(error?.message || error);
        log("meldingar-feil", { error: state.lastError });
        return false;
      }
    },
    status() {
      return { ...state };
    },
  };
}
