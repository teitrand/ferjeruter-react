import { useEffect, useRef, useState } from "react";
import {
  MESSAGES_POLL_MS,
  fetchFjord1Messages,
  mergeMessagePayloads,
  messagesAreStale,
  nextMessages,
} from "../../../packages/core/index.js";
import { DATA_FILES } from "../model/data.js";

/**
 * Trafikkmeldingar som loadMessages() i vanilla-appen: fila frå Actions fyrst; er ho
 * borte eller gammal, direkte frå Fjord1 (workeren, så HTML-sida). Spør på nytt kvart
 * 3. minutt når fana er synleg.
 *
 * Siste meldingar ligg i localStorage (`cache`, same nøkkel som vanilla). Dei blir vist
 * med ein gong ved oppstart og er «førre tilstand» når nye svar kjem, så omleggingar
 * Fjord1 har fjerna, blir ståande etter omlasting (withHeldMessages i core).
 *
 * - `base`: der trafikkmeldinger.json ligg (liveDataBase)
 * - `loaded`: fila useAppData alt har henta
 * - `live` = false i testar og SSR (berre `loaded`, ingen nett og ingen localStorage)
 * - `ready`: useAppData er ferdig
 * - `refresh`: aukar når sida vaknar (pageshow/focus/synleg) eller service workeren
 *   melder nye meldingar. Då blir fila henta på nytt med ein gong, utan å vente på polla.
 *
 * `failed` er sann når verken fila, Fjord1 eller cachen har gjeve meldingar
 * («Klarte ikkje hente lokale Fjord1-data» i panelet).
 * @returns {{ messages: object|null, failed: boolean }}
 */
export function useMessages(base, loaded, { live = true, ready = true, cache = null, refresh: refreshKey = 0 } = {}) {
  const [messages, setMessages] = useState(() => (live ? cache?.read() ?? null : null));
  const [failed, setFailed] = useState(false);
  // Eitt kall om gongen, òg når StrictMode køyrer effekten to gonger.
  const inflight = useRef(null);
  const kick = useRef(null);
  const have = useRef(messages);
  have.current = messages;

  useEffect(() => {
    if (!live || !ready) return undefined;
    let alive = true;
    let timer = null;
    const apply = (payload) => {
      if (alive && payload) {
        setFailed(false);
        setMessages((previous) => nextMessages(previous, payload));
      }
      return Boolean(payload);
    };
    const refresh = async (json) => {
      apply(json);
      if (json && !messagesAreStale(json)) return;
      let got = false;
      try {
        inflight.current ??= fetchFjord1Messages(fetch).finally(() => {
          inflight.current = null;
        });
        const fresh = await inflight.current;
        got = apply(mergeMessagePayloads(json, fresh) || fresh);
      } catch (error) {
        if (!json) console.error(error);
      }
      if (alive && !json && !got && !have.current) setFailed(true);
    };
    const fetchFile = async () => {
      let json = null;
      try {
        const response = await fetch(base + DATA_FILES.messages, { cache: "no-cache" });
        if (response.ok) json = await response.json();
      } catch {
        // Fila kan mangle; då spør vi Fjord1.
      }
      await refresh(json);
    };
    const poll = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!document.hidden) await fetchFile();
        if (alive) poll();
      }, MESSAGES_POLL_MS);
    };
    kick.current = () => {
      if (document.hidden) return;
      fetchFile();
      poll();
    };
    refresh(loaded);
    poll();
    return () => {
      alive = false;
      kick.current = null;
      clearTimeout(timer);
    };
  }, [base, loaded, live, ready]);

  // Vakna eller melding frå service workeren: hent no (ikkje ved fyrste teikning).
  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (lastKey.current === refreshKey) return;
    lastKey.current = refreshKey;
    kick.current?.();
  }, [refreshKey]);

  useEffect(() => {
    if (live && messages) cache?.write(messages);
  }, [live, messages, cache]);

  const shown = live ? (messages ?? loaded) : loaded;
  return { messages: shown, failed: live && failed && !shown };
}
