// Signalloggen blir henta på nytt medan sida står open (kvart 5. minutt og når sida vaknar), og eldre svar gjer han aldri eldre.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SIGNAL_LOG_MAX_AGE_MS, signalLogStale } from "../../packages/core/index.js";
import { SIGNAL_LOG_POLL_MS, nextSignalLog, signalLogUrls, validSignalLog } from "../src/model/signallog.js";

const log = (updatedAt, extra = {}) => ({ keptDays: 7, updatedAt, days: { "2026-10-10": [] }, ...extra });

test("nextSignalLog: nyaste gyldige logg vinn; ugyldig, feila eller eldre svar endrar ingenting", () => {
  const old = log("2026-10-10T17:37:45+02:00");
  const fresh = log("2026-10-10T18:37:45+02:00");
  assert.equal(nextSignalLog(old, fresh), fresh);
  assert.equal(nextSignalLog(fresh, old), fresh, "eldre svar (gammal kant-cache) gjer ikkje loggen eldre");
  assert.equal(nextSignalLog(old, null), old);
  assert.equal(nextSignalLog(old, { days: null }), old);
  assert.equal(nextSignalLog(old, "x"), old);
  assert.equal(nextSignalLog(null, fresh), fresh);
  assert.equal(nextSignalLog(null, null), null);
  const same = JSON.parse(JSON.stringify(old));
  assert.equal(nextSignalLog(old, same), old, "likt innhald: same objekt, ingen ny teikning");
  assert.equal(validSignalLog({ days: {} }), true);
  assert.equal(validSignalLog({}), false);
});

test("ein open side får ikkje «Sjekken har ikkje køyrt» når fila er fersk: etter 75 min er den gamle loggen for gammal, den nye ikkje", () => {
  const loadedAt = Date.UTC(2026, 9, 10, 14, 0);
  const first = log(new Date(loadedAt - 5 * 60000).toISOString());
  const later = loadedAt + 75 * 60000; // framleis innanfor vaktvindauget (04:00–22:40 UTC)
  assert.equal(signalLogStale(later, first), true, "utan ny henting: sida åleine gjer loggen «gammal»");
  const refetched = nextSignalLog(first, log(new Date(later - 8 * 60000).toISOString()));
  assert.equal(signalLogStale(later, refetched), false, "med ny henting: fersk");
  assert.ok(SIGNAL_LOG_POLL_MS * 2 < SIGNAL_LOG_MAX_AGE_MS, "polla er mykje tettare enn 70-minuttsgrensa");
});

test("App koplar loggen: hooken er med og vaknar saman med meldingane", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /useSignalLog\(signalLogUrls\(liveDataBase, sanntidEndpoint\), loaded\.signalLog, \{[^}]*refresh: woke\.wake/);
  assert.match(app, /\{ \.\.\.loaded, messages, signalLog \}/);
  const hook = readFileSync(new URL("../src/hooks/useSignalLog.js", import.meta.url), "utf8");
  assert.match(hook, /cache: "no-cache"/);
  assert.match(hook, /document\.hidden/, "ikkje hent i ei skjult fane");
});

test("signalLogUrls: workeren (frå sanntid-adressa) først, så fila på Pages; ingen worker når sanntid er av", () => {
  const worker = "https://w.example/v1/latest";
  assert.deepEqual(signalLogUrls("https://p.example/data/", worker), ["https://w.example/v1/signalturar", "https://p.example/data/signalturar.json"]);
  assert.deepEqual(signalLogUrls("https://p.example/data/", null), ["https://p.example/data/signalturar.json"]);
  assert.deepEqual(signalLogUrls("./data/", "https://anna.example/api"), ["./data/signalturar.json"], "berre /v1/latest-adresser");
});

test("to kjelder: den nyaste vinn uansett kva rekkjefølgje svara kjem i, og receivedAt er ikkje ein endring", () => {
  const pages = log("2026-10-10T17:37:00+02:00");
  const server = log("2026-10-10T19:30:00+02:00", { receivedAt: "2026-10-10T17:30:02.000Z" });
  assert.equal(nextSignalLog(nextSignalLog(null, pages), server), server);
  assert.equal(nextSignalLog(nextSignalLog(null, server), pages), server, "eldre Pages-fil slår ikkje serverloggen");
  const again = log("2026-10-10T19:30:00+02:00", { receivedAt: "2026-10-10T17:40:00.000Z" });
  assert.equal(nextSignalLog(server, again), server, "same logg, ny receivedAt: ingen ny teikning");
  assert.equal(signalLogStale(Date.UTC(2026, 9, 10, 17, 40), nextSignalLog(pages, server)), false);
  assert.equal(signalLogStale(Date.UTC(2026, 9, 10, 17, 40), pages), true, "Pages åleine er for gammal om to timar");
  assert.equal(signalLogStale(Date.UTC(2026, 9, 10, 15, 50), pages), false, "ein kvarts time gammal er ikkje for gammal");
});
