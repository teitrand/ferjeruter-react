# Bytet av ruter.trandal.org til React-skalet

Sjekkliste for når ruter.trandal.org skal gå frå den gamle appen (teitrand/fergeruter) til
React-skalet i dette repoet. **Ingenting her er gjort enno.** Kvart steg blir gjort for hand
av eigaren.

## Slik er det no (9. oktober 2026)

- **ruter.trandal.org** er ei vidaresending hos Domeneshop: `301` til
  `https://teitrand.github.io/fergeruter/`. Det finst ingen CNAME-fil i det gamle repoet, og
  Pages der har ikkje eige domene. Alle brukarar, òg dei med installert app, køyrer altså
  den gamle appen på **teitrand.github.io/fergeruter/**.
- **Den gamle appen** (teitrand/fergeruter, `main` → `/fergeruter/`, `dev` → `/fergeruter/dev/`)
  har alle datajobbane:
  - `update-ruter.yml` (ruter.json, kombirute.json, korrespondanse.json)
  - `update-trafikkmeldinger.yml`
  - `log-signalturar.yml`, starta av Cloudflare-workeren `signaltur-cron` (som har
    `teitrand/fergeruter` hardkoda, sjå `cloudflare/signaltur-cron/src/index.js`), med
    GitHub-cron som reserve
  - `sync-dev-folder.yml`, `pages.yml` og `test.yml`
- **React-skalet** (dette repoet) blir publisert til `https://teitrand.github.io/ferjeruter-react/`
  og les data frå `https://teitrand.github.io/fergeruter/data/` (CORS `*`).
  `https://ruter.trandal.org/data/` kan ikkje brukast: 301 utan CORS-hovud.
- **Trafikkmelding-workeren** (`fergeruter-trafikkmeldinger…workers.dev`) svarar med CORS `*`
  og treng ingen endring for nytt domene.
- **Taggar i det gamle repoet:** `vanilla-prod-2026-10-08` og `vanilla-dev-2026-10-08`.

## Før bytet

1. PWA-PR-en er merga, og Tester har godkjent https://teitrand.github.io/ferjeruter-react/
   (offline, installering, kombi via `?rute=kombi`, nn/en/de).
2. Set ein tagg i dette repoet på `main`, t.d. `react-for-bytet-ÅÅÅÅ-MM-DD`.
3. Sjekk at `vanilla-prod-2026-10-08` i det gamle repoet framleis er det `main` der byggjer
   frå, eller lag ein ny tagg på det som er i produksjon no.
4. Set ned TTL på DNS-oppføringa for ruter.trandal.org hos Domeneshop eit døgn før.
5. **Plausible:** sjå i innstillingane til sida om det er ei liste over tillatne vertsnamn.
   I dag kjem hendingane frå `teitrand.github.io`; etter bytet kjem dei frå `ruter.trandal.org`.
   Begge må vere tillatne i overgangen. Skalet sender ikkje hendingar frå `/ferjeruter-react/`,
   `/dev/` eller localhost, men gjer det i rota av eige domene.

## Sjølve bytet

1. **Repo-variabel** i teitrand/ferjeruter-react (Settings → Secrets and variables → Actions →
   Variables): `WEB_BASE` = `/`. La `DATA_BASE` vere (standard er
   `https://teitrand.github.io/fergeruter/data/`).
   Med `WEB_BASE=/` blir sida bygd for rota, utan `noindex`, og `?rute=` blir ignorert
   (kombi følgjer trafikkmeldingane, som i produksjon i dag).
2. **Pages i teitrand/ferjeruter-react** (Settings → Pages): Custom domain = `ruter.trandal.org`.
   Kjelda er GitHub Actions, så det trengst ingen CNAME-fil. Slå på «Enforce HTTPS» når
   sertifikatet er klart.
   Gjerne: verifiser domenet under kontoinnstillingane (Pages → Verified domains), så ingen
   andre kan ta det.
3. **Domeneshop:** fjern vidaresendinga (301) for ruter.trandal.org og legg inn
   `CNAME ruter → teitrand.github.io.`
4. **Køyr «Publiser React-skalet til GitHub Pages»** (workflow_dispatch), så byggjet får `/`.
5. Etter dette sender `teitrand.github.io/ferjeruter-react/` vidare til `ruter.trandal.org`.
   `teitrand.github.io/fergeruter/` (den gamle appen) står som før.

## Sjekk etterpå

- `https://ruter.trandal.org/` viser React-skalet. Kjeldekoden har `/assets/index-….js` og ingen
  `<meta name="robots" content="noindex">`.
- DevTools → Application: service worker `https://ruter.trandal.org/sw.js` med scope `/`,
  cache `fergeruter-web-<hash>`, og manifestet utan feil. Offline etter éi lasting.
- Data lastar (ruter, kombirute, meldingar, signallogg), Entur gjev posisjon, og trafikkmeldingar
  frå workeren kjem når fila er gammal.
- Plausible får hendingar med vertsnamnet ruter.trandal.org.
- `?rute=kombi` gjer ingenting på ruter.trandal.org (berre på førehandsvisinga).

## Installerte gamle appar

- Ein app installert frå den gamle sida har `start_url`, `scope` og `id`
  `https://teitrand.github.io/fergeruter/`. Han blir **ikkje** flytta til det nye domenet, og
  service workeren der held fram med den gamle appen.
- Skalet sin service worker har scope `/ferjeruter-react/` eller `/`. På eige domene er det eit
  anna opphav, så han kan aldri ta over eller endre den gamle appen.
- Den gamle appen må difor stå (og datajobbane må gå) til dei fleste har teke i bruk den nye.
  Seinare kan det gamle repoet få ei lita endring som viser «Appen har flytta til
  ruter.trandal.org». Det er ein eigen PR der, med godkjenning.
- localStorage flyttar ikkje mellom opphav. Etter bytet startar alle med standardval (samband,
  språk), tom meldingscache og tom rutetabell-cache. Det går seg til ved fyrste lasting.

## Flytting av datajobbane (seinare, eige steg)

Bytet over krev ikkje at datajobbane flyttar. Når dei skal flytte:

1. Kopier `update-ruter.yml`, `update-trafikkmeldinger.yml`, `log-signalturar.yml` (og
   `scripts/commit_on_main.py` med testane) frå det gamle repoet hit. Dei vart fjerna i den
   fyrste commiten på `main` i dette repoet. Gje dei `contents: write`.
2. Kopier dei siste `data/*.json` frå det gamle repoet (særleg `signalturar.json`, som har
   historikk), så ingenting startar tomt.
3. `pages.yml` må byggje på nytt etter kvar data-commit (push til `main` gjer det). Set
   `DATA_BASE` til `./data/`, eller fjern variabelen og endre standarden i `pages.yml`, så
   skalet les sine eigne filer.
4. Cloudflare-workeren `signaltur-cron`: byt `teitrand/fergeruter` til `teitrand/ferjeruter-react`
   og gje tokenet tilgang dit. Deploy med wrangler.
5. Når dei nye jobbane har gått grønt eit døgn: slå av (Disable workflow) dei same jobbane i
   det gamle repoet. Ikkje la begge køyre lenge, for då blir Entur og Fjord1 spurde to gonger,
   og signalloggen blir delt i to.
6. Den gamle appen på `/fergeruter/` får då ikkje nye data lenger. Gjer det etter at
   «flytta»-meldinga er ute.

## Rull tilbake

- **Rask:** Domeneshop: fjern CNAME og legg inn att vidaresendinga `301` til
  `https://teitrand.github.io/fergeruter/`. Fjern eige domene i Pages for ferjeruter-react.
  Den gamle appen og datajobbane er ikkje endra, så han er klar med ein gong.
- Har den gamle appen endra seg sidan: byggjer `main` frå taggen `vanilla-prod-2026-10-08`
  (eller taggen frå «Før bytet»).
- Brukarar som har fått skalet sin service worker på ruter.trandal.org: navigering går «nett
  først», så 301-en blir følgd og dei hamnar i den gamle appen når dei er på nett. Offline kan
  dei sjå det cacha skalet til nettlesaren ryddar.
- React-skalet kan rullast tilbake til taggen frå «Før bytet» med workflow_dispatch på den.

## Rydding når bytet står (eigen PR)

- Vanilla-appen: `assets/app.js`, den statiske markupen i `index.html`, `sw.js` og
  `manifest.webmanifest` i rota. Behald `assets/i18n.js`, `assets/styles.css`, `assets/icons/`
  og `assets/favicon.svg`, som skalet brukar, eller flytt dei inn i `web/`.
- Testar som les `assets/app.js`: `test_status`, `test_plausible`, `test_sw`, delar av
  `test_web` og replay-hjelparen.
- Python-datajobbane, `cloudflare/` og `data/` om dei ikkje er flytte hit (sjå over).
- `?v=` i importane i `packages/core` (berre vanilla treng dei).
