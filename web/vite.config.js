import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { noindexUnlessRoot } from "./build/noindex.js";
import { pwaAssets } from "./build/pwa-assets.js";
import { repoData } from "./build/repo-data.js";
import { stripVersionQuery } from "./build/strip-version-query.js";

// React-skalet. Byggjet går til web/dist og rører ikkje vanilla-appen i / eller /dev/.
// packages/core og assets/ ligg utanfor web/, men innanfor npm-workspacen i rota, som
// Vite sjølv opnar for (server.fs.allow er ikkje sett med vilje).
//
// WEB_BASE: stien sida ligg under. Standard «./» (relativt, verkar overalt). Pages-
// arbeidsflyten set «/ferjeruter-react/» (prosjektside); for eige domene i rota: «/».
// VITE_DATA_BASE: der data/*.json ligg. Er han sett (t.d. produksjonsfilene til
// fergeruter), blir den lokale kopien i dist/data/ ikkje lagd, så ingen gamle filer
// blir liggjande i byggjet.
// Manifest og ikon: build/pwa-assets.js. Service workeren: scripts/build-sw.mjs etter byggjet.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const base = env.WEB_BASE || "./";
  return {
    base,
    plugins: [stripVersionQuery(), repoData({ emit: !env.VITE_DATA_BASE }), pwaAssets(), noindexUnlessRoot(base), react()],
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
