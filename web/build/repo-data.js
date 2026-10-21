import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** data/ i rota av repoet. Same filer som vanilla-appen les. */
const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

/** Ferske filer appen les frå workeren/LIVE_DATA_BASE: ein gammal kopi i byggjet ville berre villeie (21.10: frå august). */
export const NOT_IN_BUILD = new Set(["trafikkmeldinger.json"]);

function dataFiles() {
  return readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"));
}

/**
 * Gjer data/*.json tilgjengeleg for React-skalet utan å kopiere filene inn i web/.
 * - `vite` (dev): serverar /data/<fil>.json direkte frå data/ i repoet.
 * - `vite build`: legg ein kopi i dist/data/, så dist/ kan prøvast åleine med
 *   `vite preview`. Når skalet blir publisert, les det dei levande filene via
 *   VITE_DATA_BASE, og då blir kopien ikkje lagd (`emit: false`).
 */
export function repoData({ emit = true } = {}) {
  return {
    name: "fergeruter:repo-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/(?:.*\/)?data\/([\w-]+\.json)(?:\?.*)?$/.exec(req.url || "");
        if (!match || !dataFiles().includes(match[1])) return next();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(readFileSync(DATA_DIR + match[1]));
      });
    },
    generateBundle() {
      if (!emit) return;
      for (const name of dataFiles().filter((file) => !NOT_IN_BUILD.has(file))) {
        this.emitFile({ type: "asset", fileName: `data/${name}`, source: readFileSync(DATA_DIR + name) });
      }
    },
  };
}
