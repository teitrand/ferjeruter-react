# KISS-plan: enklare bygd, same verdi for den reisande

Stand 9. oktober 2026. Berre plan, ingen refaktorering før Tor Eirik har godkjent. Inndata: `docs/funksjonsgjennomgang.md` (PR #17), andrehandsmeininga frå Cursor-agenten (bc-75a2aa9f) og ein gjennomgang av koden etter PR #18.

## Reglar

1. **Ingen funksjon forsvinn.** Dei kutta i PR #17 som tek bort noko den reisande ser eller kan gjere (frå/til, korrespondanse, ankomstbrytar, dialogar, signaltur-tilstandar, meldingar, installhjelp, tilbakemelding, språk, frakopla) er **ikkje** med her.
2. **Verdi bevart** er sjekka per punkt: same informasjon, same nøyaktigheit, same ærlege kjeldemerke, same frakopla- og reserveåtferd. Ser eg at verdien kan falle, ligg punktet under «Treng di avgjerd», ikkje i planen.
3. **Prov før endring:** karakteriseringstestar kjem først og skal vere grøne før og etter. Ei einaste avvikande utskrift i ein golden-fil stoppar jobben, med mindre Tor Eirik har godkjent avviket. Etter kvar PR: headless samanlikning av preview mot førre main (Nå-rad, topptekst, merke, fot, 1136 og 1135), slik vi gjorde for PR #18.
4. Éin PR per punkt, minste mogleg, CI grøn, ikkje slått saman før du har sett han.

Ærleg storleik: «enklare» her er mest **struktur og éi kjelde**, ikkje mange kuttlinjer. Eg reknar −250 til −350 kjeldelinjer samla (usikkert, merkt under) og +150 til +300 testlinjer. Dei store tala i PR #17 kjem av funksjonskutt eller av vanilla-fjerning etter domenebyte, og er ikkje i denne planen.

## Planen, i rekkjefølgje

| # | Kva endrar seg | Kvifor enklare | Verdi bevart | Prov (karakterisering) | Linjer | Risiko |
|---|---|---|---|---|---|---|
| 1 | **Karakteriseringstestar først.** (a) Golden-matrise for `{topptekst, Nå-rad, merke, aria}` i nn over åtte tilstandar: natt ved kai (AIS), på veg (AIS), berre Entur, berre rutetabell, avlyst, signaltur, utanfor ruta, kombirute. (b) Gjer replay-golden (`tripstatus_replay_golden.json`) sjølvstendig: i dag treng han git-taggen `vanilla-dev-2026-10-08` og feilar utan han. (c) Golden av `timelineEvents` for alle datoar og begge samband frå `tests/fixtures/ruter.json`. | Ingen kjeldeendring. Gjer alle neste punkt tryggare. | Ja, ingen åtferd rørt. | Er sjølve provet. | +150 til +300 test | Låg |
| 2 | **Fjern unødvendig `export`** (ca. 40 stader som knip viser: konstantar og hjelparar som berre blir brukte i eiga fil) og eit manuelt `npm run dead` (knip), ikkje i CI. | Mindre API-flate, tydelegare kva modular tilbyr. | Ja. | Minifisert bunt skal vere uendra (samanlikn filhash) pluss alle testar. | 0 | Svært låg |
| 3 | **Éin kjelde for statusteksten.** Etter PR #18 reknar toppteksten og Nå-rada same status, men Nå-rada set sjølv saman «ligg til kai på X» i `nowInfo`. Flytt det til `nowStatus()` som gjev `{ short, place }`; både topptekst og Nå les derifrå. | Éin stad som avgjer teksten. | Ja, så lenge teksten er lik i dag (golden 1a). Skilnaden som finst i dag ved same kai er flytta til «Treng di avgjerd» D1. | Golden 1a. | −30 | Låg |
| 4 | **Del `crossing.js` (678 linjer) i tre filer, utan å endre logikk:** `fix.js` (PositionFix, `bestFix`, ferskleik, `fixFromAis`/`fixFromLive`), `crossingView.js` (visning og tekstar), `positionStatus.js` (`statusFromPosition`, utanfor ruta). Same eksportar frå `index.js`. | Mindre moduler, namn som seier kva dei gjer. Ei fil gjer éin ting. | Ja. | Alle testar og golden 1a. Bunt innan ±1 %. | 0 (flytting) | Låg |
| 5 | **Same for `messages.js` (678):** `messages/parse.js` (Fjord1 HTML og payload, samanslåing), `messages/classify.js`, `messages/routePlan.js` (modus, vindauge, bytte). Ingen logikkendring. | Fritekst-tolking og samanslåing skild frå sambandsval. | Ja. | `test_route_mode.mjs` (1656 linjer) og `test_status.mjs` uendra. | 0 (flytting) | Låg |
| 6 | **Tidslinje-overgangar.** `hubTransfers`, `collapseHubWait`, `ferryTransferIndex`, `dayStartSplit` og `timelineEvents` gjer nesten same gjennomgang fleire gonger. Slå saman passa der golden 1c viser identisk utskrift. | Færre passeringar og mellomstrukturar. | Ja, same rader, same tider, same delingsrad ved tabellskifte. | Golden 1c over alle datoar og samband. | −60 til −100 (usikkert) | Middels |
| 7 | **Meldingsautomaten.** `modeFromText`, `windowFromText`, `switchFromText`, `activateAtFromText`, `textRouteWindow` m.fl. blir éi tabell av reglar med felles vindaugs-hjelpar i staden for fleire nesten like regex-greiner. | Éin stad å lese «når gjeld kombirute». | Ja, same modus og same vindauge for alle meldingar i testane og fixture-meldingane. Avvik = stopp. | `test_route_mode.mjs` pluss golden over `data/trafikkmeldinger.json` og fixtures. | −80 til −120 (usikkert) | Middels |
| 8 | **`tripstatus.js` (34 funksjonar).** Les først, forenkle berre greiner som gjev same utfall i golden 1b: `skipEvidence`, `signalBooking`, `oppositeReturns`, `departureEvidence`. Alle fem tilstandane (går, avlyst, gått, bestilt, ikkje utført) og signalloggen blir ståande. | Færre grener i det mest lesevanskelege biletet. | Ja, same status per avgang over heile replay-golden. | `test_tripstatus.mjs` (306) og replay-golden. | −40 til −80 (usikkert) | Middels–høg, difor sist |

Rekkjefølgje: 1, 2, 3, 4, 5 er trygge og kan gå først (ei veke). 6–8 først når golden i 1 er på plass og vist grøn.

## Byggjing og CI: lite å hente

Her er berre to arbeidsflyter (`test.yml`, `pages.yml`), ingen cron og ingen jobbar som skriv til `main`. Det er alt enkelt. Eg foreslår **inga endring** no, utanom at 1b gjer replay-testen sjølvstendig. To service workerar (`sw.js` for vanilla og `web/pwa/sw-template.js`) og `?v=`-prefikset er ikkje overflødige så lenge vanilla ligg her, sjå D3.

## Treng di avgjerd (ikkje i planen, verdi kan falle eller eigarskap er uklart)

- **D1. Same ordlyd i topptekst og Nå.** Natt ved kai viser i dag toppteksten «Ferja er ferdig for dagen på Standal» og Nå-rada «Ferja ligg til kai på Standal». Éin setning er enklast, men då må vi velje: «ligg til kai» (ærleg frå AIS, men «ferdig for dagen» går tapt i toppen) eller «ligg til kai på Standal, ferdig for dagen». Informasjonen om siste tur er då berre i «Første tur i morgon …». Eit synleg tekstval, så eg gjer det ikkje utan di godkjenning.
- **D2. Pythonskripta og testane deira i dette repoet** (`scripts/*.py` ca. 2 500 linjer og `tests/test_*.py`). CI her seier «datajobbar køyrer i fergeruter». Er skripta berre ein kopi, kan dei vekk. Eg kan ikkje bevise det herifrå; flyttar du datafangsten hit seinare, trengst dei. Gjeld mest 2 500 linjer, men berre du veit eigarskapen.
- **D3. Vanilla-kopien, rot-`sw.js`, `?v=`-prefikset og `strip-version-query` i dette repoet** (ca. −2 800 kjelde og −1 200 testlinjer). Tryggast etter domenebyte. Då fell òg «to service workerar» og versjonsprefikset bort.
- **D4. Entur-fangsten i innsamlaren, signalloggen og Entur som posisjonsreserve.** Appen les i dag berre AIS frå workeren, men Entur-hendingane er grunnlaget for `compare.js` og signalloggen er det som gjev «bestilt / ikkje utført». Fjerning kan kutte verdi (frakopla og reserve, bestilling etter ny opning). Ikkje rørt før AIS har gått stabilt nokre veker og samanlikninga er lesen.
- **D5. Kombirute og meldingar.** Å gjere kombirute-bytet eksplisitt, eller å vise meldingar utan tolking, er ei åtferdsendring og kan gje feil tabell eller mindre informasjon. Ikkje med; planen over (punkt 5 og 7) held tolkinga lik.
