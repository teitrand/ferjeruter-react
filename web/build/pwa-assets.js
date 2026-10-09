/**
 * Manifest og ikon for skalet, frå filene til vanilla-appen (manifest.webmanifest og
 * assets/icons/, assets/favicon.svg i rota av repoet), så det finst éin kopi.
 *
 * - Byggjet: legg manifest.webmanifest, favicon.svg og icons/*.png i dist/.
 *   Ikona får nye stiar (icons/…) og ingen ?v=, så precache og manifest peikar på same fil.
 * - vite dev: serverer dei same filene.
 * - index.html: lenkjene (ikon, apple-touch-icon, manifest) blir sette inn her med relative
 *   stiar. Sida ligg alltid i rota av byggjet, så dei verkar både under /ferjeruter-react/
 *   og i rota av eige domene.
 *
 * Manifestet har start_url, scope og id «./», altså mappa skalet ligg i. Det gjer
 * appen til ein annan app enn den gamle (teitrand.github.io/fergeruter/), så ein
 * installert gammal PWA blir ikkje erstatta eller endra.
 */
import { readFileSync } from "node:fs";

const repo = new URL("../../", import.meta.url);
const ICONS = ["icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "apple-touch-icon.png"];

/** Manifestet til vanilla-appen med ikonstiane til skalet. */
export function shellManifest(text = readFileSync(new URL("manifest.webmanifest", repo), "utf8")) {
  const manifest = JSON.parse(text);
  manifest.icons = manifest.icons.map((icon) => ({
    ...icon,
    src: icon.src.replace(/^assets\/icons\//, "icons/").replace(/\?.*$/, ""),
  }));
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Filene som skal liggje i dist/: namn → innhald. */
export function pwaFiles() {
  const files = {
    "manifest.webmanifest": shellManifest(),
    "favicon.svg": readFileSync(new URL("assets/favicon.svg", repo)),
  };
  for (const name of ICONS) files[`icons/${name}`] = readFileSync(new URL(`assets/icons/${name}`, repo));
  return files;
}

export const HEAD_LINKS = [
  { rel: "icon", href: "favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "icons/apple-touch-icon.png" },
  { rel: "manifest", href: "manifest.webmanifest" },
];

const TYPES = { ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };

export function pwaAssets() {
  return {
    name: "fergeruter-pwa-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const base = server.config.base || "/";
        const url = (req.url || "").split("?")[0];
        const path = url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, "");
        const files = pwaFiles();
        if (!Object.hasOwn(files, path)) return next();
        const ext = path.slice(path.lastIndexOf("."));
        res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
        res.end(files[path]);
      });
    },
    transformIndexHtml: {
      order: "post",
      handler() {
        return HEAD_LINKS.map((attrs) => ({ tag: "link", attrs, injectTo: "head" }));
      },
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(pwaFiles())) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}
