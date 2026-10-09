/**
 * Oppsett frå miljøet (systemd: EnvironmentFile=/etc/fergeruter/collector.env).
 * Alle verdiar har trygge standardar, så tenesta startar utan fil. Avsendaren til
 * Cloudflare er AV til både FERGERUTER_SENDER_ENABLED=1, URL og nøkkel er sette.
 */
import { join } from "node:path";

const on = (value) => /^(1|true|yes|ja)$/i.test(String(value || "").trim());
const int = (value, fallback, min) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

/** @param {Record<string, string|undefined>} env */
export function loadConfig(env = process.env) {
  const stateDir = env.FERGERUTER_STATE_DIR || "/var/lib/fergeruter";
  const senderUrl = env.FERGERUTER_SENDER_URL || "";
  const senderKey = env.FERGERUTER_SENDER_KEY || "";
  return {
    stateDir,
    dbPath: env.FERGERUTER_DB || join(stateDir, "collector.sqlite"),
    statusPath: env.FERGERUTER_STATUS || join(stateDir, "status.json"),
    reportDir: env.FERGERUTER_REPORT_DIR || join(stateDir, "reports"),
    cacheDir: join(stateDir, "cache"),
    lines: (env.FERGERUTER_LINES || "1136,1135").split(",").map((s) => s.trim()).filter(Boolean),
    retentionDays: int(env.FERGERUTER_RETENTION_DAYS, 30, 1),
    // Datafilene appen les (rutetabell, signallogg, meldingar). Berre for status og samanlikning.
    dataBase: (env.FERGERUTER_DATA_BASE || "https://teitrand.github.io/fergeruter/data/").replace(/\/?$/, "/"),
    // Straum er standard. «rest» tvingar REST-polling (berre for feilsøking).
    mode: env.FERGERUTER_MODE === "rest" ? "rest" : "stream",
    statusEveryMs: int(env.FERGERUTER_STATUS_EVERY_MS, 30000, 5000),
    // Lokal status på 127.0.0.1 (GET /status, /healthz). 0 = av.
    httpPort: int(env.FERGERUTER_HTTP_PORT, 8787, 0),
    sender: {
      enabled: on(env.FERGERUTER_SENDER_ENABLED) && Boolean(senderUrl) && Boolean(senderKey),
      requested: on(env.FERGERUTER_SENDER_ENABLED),
      url: senderUrl,
      key: senderKey,
    },
  };
}
