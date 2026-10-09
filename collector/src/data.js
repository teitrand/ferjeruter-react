/**
 * Datafilene appen les (rutetabell, kombirute, trafikkmeldingar, signallogg), henta frå
 * GitHub Pages (ikkje Entur) kvar time. Siste gode kopi blir lagra i cache/, så status og
 * samanlikning brukar «det vi veit» når nettet eller Pages er nede.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { legsForDate } from "../../packages/core/index.js";

export const DATA_FILES = {
  routes: "ruter.json",
  kombirute: "kombirute.json",
  messages: "trafikkmeldinger.json",
  signalLog: "signalturar.json",
};

export function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, path);
}

/**
 * @param {{ dataBase: string, cacheDir: string }} cfg
 * @returns {Promise<{ routes: any, kombirute: any, messages: any, signalLog: any, info: object }>}
 */
export async function loadData(cfg, { fetchImpl = fetch, log = () => {} } = {}) {
  mkdirSync(cfg.cacheDir, { recursive: true });
  const out = { info: {} };
  for (const [key, file] of Object.entries(DATA_FILES)) {
    const cachePath = join(cfg.cacheDir, file);
    try {
      const res = await fetchImpl(cfg.dataBase + file, { signal: AbortSignal.timeout(20000), cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      writeJsonAtomic(cachePath, body);
      out[key] = body;
      out.info[key] = { from: "network", at: new Date().toISOString() };
    } catch (error) {
      try {
        out[key] = JSON.parse(readFileSync(cachePath, "utf8"));
        out.info[key] = { from: "cache", error: String(error?.message || error) };
      } catch {
        out[key] = null;
        out.info[key] = { from: "none", error: String(error?.message || error) };
      }
      log("data-feil", { file, error: String(error?.message || error), fallback: out.info[key].from });
    }
  }
  return out;
}

/** Turane appen viser for `line` på `date`, med same plan-logikk som appen. */
export function legsFor(data, line, date, nowMs = Date.now()) {
  if (!data?.routes && !data?.kombirute) return [];
  try {
    return legsForDate(date, {
      routes: data.routes,
      kombirute: data.kombirute,
      messages: data.messages?.messages,
      routeChoice: String(line),
      override: null,
      fromQuery: null,
      nowMs,
      today: date,
      date,
    });
  } catch {
    return [];
  }
}
