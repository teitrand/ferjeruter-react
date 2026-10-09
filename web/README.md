# React-skalet (web/)

Vite + React i vanleg JavaScript (JSX) med JSDoc. Skalet byggjer til `web/dist/` og blir
publisert til https://teitrand.github.io/ferjeruter-react/ av `.github/workflows/pages.yml`.
Vanilla-appen i rota av repoet er berre att som referanse til bytet (sjå `docs/bytet-til-react.md`).

```sh
npm ci                 # i rota av repoet (npm workspaces: packages/core og web)
npm run dev:web        # http://localhost:5173/ (?rute=kombi fungerer lokalt)
npm run build:web      # web/dist/ med index.html, hash-filer, data/, manifest, ikon og sw.js
WEB_BASE=/ferjeruter-react/ VITE_DATA_BASE=https://teitrand.github.io/fergeruter/data/ npm run build:web  # som Pages
npm run test:web       # teiknar <App> med fast data via Vite SSR
```

## Oppbygging

- `src/model/`: rein tilstandsmodell utan React/DOM. Byggjer `ctx`, `ev` og `view` til
  `packages/core` og gjer om til rader (`timeline.js`) og statuslinje (`header.js`).
  Testa mot vanilla-appen i `tests/test_web.mjs` (køyrer i CI utan node_modules).
- `src/state.js`: UI-reduceren (samband, dag, språk, vis tidlegare).
- `src/hooks/`: `useAppData` (data/*.json, rutetabell-cache), `useMessages`, `useEntur`,
  `useClock` (minuttikk), `useWake` (pageshow/focus/synleg og meldingar frå service workeren)
  og `useInstall` (installeringa til nettlesaren eller rettleiinga).
- `src/pwa/register.js`: registrerer `sw.js` og fangar `beforeinstallprompt` før React monterer.
- `src/components/`: Header (språk, tittel, samband, statuslinje), DayNav, Timeline, Footer.
  Same klassenamn som vanilla-appen, så `assets/styles.css` blir brukt som han er.

## ?v= i core

Core importerer med `?v=<versjon>` for vanilla-appen. `build/strip-version-query.js` fjernar
`?v=<tal>` på relative importar før Vite løyser dei. Utan det blir `assets/i18n.js` to modular
(éin med og éin utan `?v=`), og språkbytet når berre den eine.

## Data, PWA og service worker

- `build/repo-data.js`: `vite` serverar `data/*.json` frå rota; byggjet legg ein kopi i
  `dist/data/` når `VITE_DATA_BASE` ikkje er sett.
- `build/pwa-assets.js`: `manifest.webmanifest`, `favicon.svg` og `icons/` frå filene til
  vanilla-appen, og lenkjene i `<head>` (relative, så dei verkar under `/ferjeruter-react/`
  og i rota). `build/noindex.js`: «noindex» på alt anna enn `WEB_BASE=/`.
- `pwa/sw-template.js` + `scripts/build-sw.mjs`: `dist/sw.js` med precache av byggjet,
  cachenamn `fergeruter-web-<hash>` og datafilene frå `VITE_DATA_BASE` (òg på eit anna
  opphav). Scope er mappa sw.js ligg i, så han rører aldri den gamle appen på `/fergeruter/`.
- localStorage: val (samband, språk, ankomsttider) og meldingscachen brukar same nøklar som
  vanilla. Rutetabell-cachen og siste samband har eigne `fergeruter-web-`-nøklar.
