// Lagar dist/sw.js for React-skalet frå malen i pwa/sw-template.js (ikkje Workbox).
// Køyrer etter `vite build` (npm run build).
//
// Fyller inn:
// - CACHE: «fergeruter-web-<hash av byggjet>». Same opphav som vanilla-appen
//   (teitrand.github.io) deler CacheStorage, så namnet må aldri likne «fergeruter-v<n>».
// - PRECACHE: filene i dist/ (hash-namn frå Vite), relativt til sw.js, så det verkar
//   både under /ferjeruter-react/ og i rota av eige domene.
// - DATA_URLS: datafilene når VITE_DATA_BASE / VITE_LIVE_DATA_BASE peikar ut av byggjet.
//   Dei blir lasta på førehand utan å stoppe installeringa, og cacha under bruk.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CACHE_LINE = /^const CACHE = .*;$/m;
const PRECACHE_LINE = /^const PRECACHE = \[\];$/m;
const DATA_LINE = /^const DATA_URLS = \[\];$/m;

const TIMETABLE_FILES = ["ruter.json", "kombirute.json", "korrespondanse.json"];
const LIVE_FILES = ["trafikkmeldinger.json", "signalturar.json"];

/** Alle filer under `dir`, relativt og med «/», sortert. sw.js sjølv er ikkje med. */
export function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.filter((file) => file !== "sw.js").sort();
}

/** Kort hash av innhaldet i filene. Ny versjon når eitt byte i byggjet endrar seg. */
export function buildVersion(dir, files, extra = "") {
  const hash = createHash("sha256");
  hash.update(extra);
  for (const file of files) {
    hash.update(file);
    hash.update(readFileSync(join(dir, file)));
  }
  return hash.digest("hex").slice(0, 10);
}

const absolute = (base) => /^https?:\/\//.test(base || "");
const withSlash = (base) => (base.endsWith("/") ? base : `${base}/`);

/**
 * Datafiler som ligg utanfor byggjet (fulle URL-ar). Relative basar (./data/) er alt
 * med i precache via dist/data/. Same reglar som dataBase()/liveDataBase() i model/data.js.
 */
export function dataUrls(env = {}) {
  const base = env.VITE_DATA_BASE;
  const live = env.VITE_LIVE_DATA_BASE || base;
  const out = [];
  if (absolute(base)) out.push(...TIMETABLE_FILES.map((file) => withSlash(base) + file));
  if (absolute(live)) out.push(...LIVE_FILES.map((file) => withSlash(live) + file));
  return out;
}

/**
 * Fyller ut malen. Kastar feil om malen har endra form, så byggjet stoppar i staden
 * for å lage ein halvveges service worker.
 */
export function renderServiceWorker(template, { version, files, data = [] }) {
  for (const [name, pattern] of [["CACHE", CACHE_LINE], ["PRECACHE", PRECACHE_LINE], ["DATA_URLS", DATA_LINE]]) {
    if (!pattern.test(template)) throw new Error(`Fann ikkje ${name} i sw-malen`);
  }
  const precache = ["./", ...files.map((file) => `./${file}`)];
  return template
    .replace(CACHE_LINE, `const CACHE = "fergeruter-web-${version}";`)
    .replace(PRECACHE_LINE, `const PRECACHE = ${JSON.stringify(precache, null, 2)};`)
    .replace(DATA_LINE, `const DATA_URLS = ${JSON.stringify(data, null, 2)};`);
}

function main() {
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const template = readFileSync(new URL("../pwa/sw-template.js", import.meta.url), "utf8");
  const files = listFiles(dist);
  const data = dataUrls(process.env);
  const version = buildVersion(dist, files, template + data.join("\n"));
  writeFileSync(join(dist, "sw.js"), renderServiceWorker(template, { version, files, data }));
  console.log(`dist/sw.js: fergeruter-web-${version}, ${files.length + 1} filer i precache, ${data.length} datafiler utanfrå`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
