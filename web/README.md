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

## Visuell sjekk

Rutina: 360/390/412/430/440 px (telefon), foldbar og nettbrett (768–1180, stå og liggjande), lyst og mørkt, normal og 130 % tekst. 320 px/200 % er berre røyktest. Sjå `docs/visuell-sjekk.md` og `scripts/visual-sweep.mjs`.

## Fargetema (lys/mørkt)

Standard er å følgje eininga (`prefers-color-scheme`, endrar seg live); knappane **Enhet / Lys / Mørk** i toppen overstyrer, og valet ligg i `localStorage` (`fergeruter-theme`; «Enhet» fjernar nøkkelen).

- `src/model/theme.js`: oppløysing, lagring og `applyTheme` (sett `data-theme` på `<html>`, `color-scheme` og `<meta name="theme-color">`).
- `build/theme-early.js`: same regel som eit lite skript i `<head>`, så temaet står før fyrste teikning (ingen blink). `tests/theme.test.mjs` køyrer skriptet mot modellen.
- Fargar er roller (tokens). Lyse verdiar ligg i `assets/styles.css`, `crossing.css`, `nowcard.css` og `picker.css`; dei mørke i `src/styles/theme.css` under `html[data-theme="dark"]`. Nye komponentar brukar rolletokens, ikkje faste fargar.
- `tests/theme-contrast.test.mjs` les dei faktiske CSS-filene og krev ≥ 4,5:1 for tekst og ≥ 3:1 for status-, kai- og ferjefargar i begge tema. Legg nye par i lista der.
- Manifestet kan ikkje skifte `theme_color` med temaet; det står på lyst tema (`#073b4c`). `<meta name="theme-color">` blir oppdatert i køyrande side og vinn i nettlesaren og i installert app.

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
- AIS-posisjon: `hooks/useSanntid.js` + `model/sanntid.js` hentar `GET /v1/latest` frå workeren
  `fergeruter-sanntid` (`lines[<linje>].ais`) kvart 15. s i driftsvindauget og kvart minutt utanfor (AIS sender heile døgnet, òg frå ei ferje ved kai). Rekkefølgja er
  AIS > Entur > rutetabell (core `bestFix`), og live-merket, kjeldelina, aria-teksten og fotnoten
  seier kva posisjonen faktisk kjem frå («Live frå AIS» / «Live frå Entur» / «Siste kjende frå AIS» /
  «Berekna frå rutetabellen»). Nede eller treg worker (4 s) gjer ingenting vondt: siste posisjon
  eldast (Live → Siste kjende → Ukjent), så tek Entur over, så rutetabellen. Adressa kan
  overstyrast med `VITE_SANNTID_URL`; `off` slår AIS av.
  Fort ved opning: `build/early-sanntid.js` set inn `preconnect` og ei tidleg henting i `<head>` (appen brukar
  svaret, `model/sanntidEarly.js`), fyrste kall ventar ikkje på rutetabellen, og siste kjende posisjon ligg i
  localStorage (`model/sanntidCache.js`, nøkkel `fergeruter-sanntid-v1`, med den verkelege alderen frå `msgtime`).
  Før fyrste svar viser merket «Hentar posisjon …» i staden for «Berekna frå rutetabellen». Nytt kall òg ved
  `focus`, `online` og `visibilitychange` (framleis 15/60 s mellom kall).
- localStorage: val (samband, språk, ankomsttider) og meldingscachen brukar same nøklar som
  vanilla. Rutetabell-cachen og siste samband har eigne `fergeruter-web-`-nøklar.
