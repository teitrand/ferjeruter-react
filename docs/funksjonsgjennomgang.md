# Funksjonsgjennomgang: kva gjer appen, og kva er det verd for den reisande?

*«Even a fool can make something complicated, but only a genius can make it simple.»*

Stand 9. oktober 2026. Berre lesing og analyse, ingen kodeendringar. Referanse: gamal vanilla-app
(`teitrand/fergeruter`, `assets/app.js` 5 213 linjer i éin fil) og React-appen (`teitrand/ferjeruter-react`:
`packages/core` + `web/`). Logikken er flytta til `packages/core` og delt, så funksjonane er same i begge;
React-repoet har i tillegg AIS, «Nå»-raden med neste avgang og «Om dataa».

## Slik er tala lesne

- **Linjer** er `wc -l` på filene som høyrer til funksjonen (ca., utan testar og data). Heile kodebasen er om lag
  **19 100 linjer** utan testar (≈ 10 300 testlinjer kjem i tillegg): core 4 806, web 3 502, `assets/styles.css` 1 425 + `crossing.css` 286,
  `i18n.js` 1 006, vanilla `app.js`/`index.html`/`sw.js` 2 783, Python-skript 2 546, innsamlar 2 004, tre workers 746.
- **Bruk** er berre det eg faktisk kan vise. Plausible-hendingane (`README.md`, «Plausible») finst for nesten alle
  interaksjonar, men **eg har ikkje tilgang til tala**. Der står «tal: ukjent». «Kvar vitjing» er mi vurdering av korleis
  ein reisande brukar sida, ikkje ei måling. Første steg før kutt: les måla i Plausible (Goals) for hendingane under.
- **Kostnad** = kompleksitet og vedlikehald: låg / middels / høg.

## 1. Tidslinje og avgangar

| Funksjon | Kva | Kvar (ca. linjer) | Bruk | Verdi | Kostnad | Tilråding |
|---|---|---|---|---|---|---|
| Dagens avgangar i rekkjefølgje | Alle anløp med tid, frå/til, status | `core/timeline.js` 416, `timetable.js` 370, `plan.js` 187, `legs.js` 51; `Timeline.jsx` 297, `model/timeline.js` 234 | Kvar vitjing (vurdering) | Høg | Middels | **Behald.** Kjernen. |
| Rutedata | Rutetabell frå Entur per døgn | `scripts/fetch_ruter.py` 329, `data/ruter.json`, workflow | Kvar vitjing | Høg | Middels | **Behald.** |
| Dagblading (i går/i morgon/i dag) | Planleggje fram | `DayNav.jsx` 22 | `Day prev/next/today`: tal ukjent | Middels | Låg | **Behald.** |
| «Vis tidlegare» | Folde ut gamle anløp | i `Timeline.jsx`, `model/timeline.js` | `Show past/Hide past`: tal ukjent | Låg–middels | Låg | **Forenkle:** gøym tidlegare i éi rad «Tidlegare i dag (n)». |
| Tomflytting/venting/overgang-rader | Forklarer at ferja flyttar seg utan passasjerar, ligg over | `Timeline.jsx` (Split/Wait/Layover/Transfer), `timeline.js` | Berre enkelte dagar (vurdering) | Låg | Middels | **Fjern som eigne rader**, éi fotnote-linje i staden (≈ −175). |
| Avgangsdetalj (dialog) | Meir om ein avgang, signaltur-info | `DepartureDialog.jsx` 45, `core/detail.js` 112, `controls.js` | `Departure detail`: tal ukjent | Middels | Låg–middels | **Slå saman:** vis detaljen inline i radene, ingen dialog (≈ −100). |
| Frå/til-filter + byt retning | Filtrer på kai, bytt retning | `TripControls.jsx` 82, `model/controls.js` 73 | `From x`, `To x`, `Swap direction`: tal ukjent | Middels (få kaier) | Middels | **Forenkle:** eitt val «Vis avgangar frå: Alle / kai». Fjern «til» og byt retning (≈ −150). Avgjer etter Plausible. |
| «Skjul ankomstar» | Berre vis avgangar | `ExtrasRow`, prefs | `Hide/Show arrivals`: tal ukjent | Låg | Låg | **Fjern.** Vis berre avgangar som standard. |

## 2. Nå og status

| Funksjon | Kva | Kvar | Bruk | Verdi | Kostnad | Tilråding |
|---|---|---|---|---|---|---|
| Statuslinje øvst («lede») | «Ferja ligg til kai på X. Neste avgang …» | `core/status.js` 430, `model/header.js` 113, `Header.jsx` 108 | Kvar vitjing | Høg | Middels | **Slå saman med «Nå»-raden.** Same melding to gonger på skjermen (t.d. «Ferja er ferdig for dagen på Standal» og «Ferja ligg til kai på Standal»). Éin stad: «Nå». |
| «Nå»-rada | Kjelde-merke, ferjelinje, kvar/neste tur/varigheit | `LiveCrossing.jsx` 133, `core/nowinfo.js` 152, `crossing.js` 681, `usePositionState.js` 39, `crossing.css` 286 | Kvar vitjing | Høg | Høg (`crossing.js`) | **Behald, forenkle `crossing.js`:** med AIS som sanning kan Entur-matching (`journeyRef`, leg-treff) og «aldri bakover»-reglane strammast inn (≈ −150). |
| Avgangsstatus (går/avlyst/gått/ikkje køyrd/ukjent) | Bevisstige per avgang | `core/tripstatus.js` 505, `live.js` 267, delar av `status.js` | Kvar vitjing (vurdering) | Høg | **Høgast** | **Forenkle til 4 tilstandar:** Går, Avlyst, Gått, Usikker. Fjern fine skilnader, og bruk AIS «har ho gått?» som bevis (≈ −200, usikkert). |
| Utanfor ruta / ekstratur | Ærleg status ved AIS langt unna eller i fart utan tur | `crossing.js` (PR #15) | Sjeldan (vurdering) | Middels | Låg | **Behald** (liten). |
| Hugsa bevis (localStorage) | Hugsar «gått» og «bestilt» mellom opningar | `model/storage.js` 125, `model/entur.js` 150 | Usynleg | Middels | Middels, skjult tilstand | **Forenkle:** AIS og Entur dekkjer «gått»; hugs berre til neste opning. |

## 3. Posisjon (AIS, Entur)

| Funksjon | Kva | Kvar | Bruk | Verdi | Kostnad | Tilråding |
|---|---|---|---|---|---|---|
| AIS-posisjon i appen | Sanning for kvar ferja er, nattestid òg | `model/sanntid*.js` ≈ 250, `useSanntid.js` 79, `cloudflare/sanntid` 320 | Kvar vitjing | Høg | Middels | **Behald.** |
| Innsamlar på heimeserveren | AIS-straum → worker | `collector/src` 2 004 (`ais.js` 393, `sender.js` 188, `stream/rest/compare/vehicles/tracker/db` ≈ 900) | Usynleg | AIS-delen høg | **Høg** | **Kutt Entur-fangsten.** Appen les berre `lines[].ais` frå workeren; `today`/hendingar/puls blir ikkje brukte (`collector.stale` blir lest, men ikkje brukt til noko). AIS-berre innsamlar ≈ 900 linjer (≈ −1 100) og worker ≈ −150. Behald berre om samanlikning AIS mot Entur skal gjerast. |
| Entur-posisjon i nettlesaren | Reserve når AIS manglar | `core/entur.js` 208, `useEntur.js` 64, `model/entur.js` 150 | Kvar vitjing, men AIS er først | Middels (avlysing og faktisk avgang er verdt det; posisjonen er reserve) | Middels | **Behald Entur for avlysing/forseinking.** Fjern posisjonsstien når AIS har vore stabil (≈ −150). |

## 4. Trafikkmeldingar

| Funksjon | Kva | Kvar | Bruk | Verdi | Kostnad | Tilråding |
|---|---|---|---|---|---|---|
| Fjord1-meldingar | Liste, filter lokalt/rute, utvid | `core/messages.js` 693, `MessagesPanel.jsx` 131, `useMessages.js` 111, `cloudflare/trafikkmeldinger` 173, `fetch_trafikkmeldinger.py` 600 | `Messages local/route`: tal ukjent. Avlysing er truleg hovudgrunnen til å opne sida (vurdering) | Høg | **Høg** (tolking av fritekst) | **Forenkle.** Vis meldinga som ho er (tittel, tekst, tid, lenkje til Fjord1). Behald berre klassifisering avlyst/forseinka for ein banner øvst (≈ −300). |
| Automatisk bytte av tabell frå meldingar | `routeMode`, kombirute vs 1136 | `messages.js`, `chrome.js` 107 | Dagar det gjeld: ukjent | Høg når det gjeld | Høg, og feil bytte er skadeleg | **Gjer eksplisitt:** banner «Fjord1 melder kombirute, vis kombirute?» i staden for stille byte. |
| Statisk reserve-JSON for meldingar | GitHub Actions-cron som skriv fil | `fetch_trafikkmeldinger.py` 600 (same fil som over), `commit_on_main.py` 214 | Berre når worker er nede | Låg | Høg (tre jobbar skriv til `main`) | **Vurder å fjerne** når workeren har vore stabil; då forsvinn `commit_on_main.py`-kappløpet. |

## 5. Signalturar

| Funksjon | Kva | Kvar | Bruk | Verdi | Kostnad | Tilråding |
|---|---|---|---|---|---|---|
| «Signaltur: ring innan kl X» | Statisk frå rutetabellen, med telefonlenkje | `core/signal.js` 99, `CallLink.jsx` 15 | `Call ferry`: tal ukjent | Høg for dei det gjeld | Låg | **Behald.** Éi tydeleg linje på avgangen. |
| Logg «bestilt / ikkje utført» | Cron-worker + GitHub-jobb loggar dagleg kva signalturar som vart køyrde | `log_signalturar.py` 633, `signaltur_loop.py` 180, `cloudflare/signaltur-cron` 253, `signalturar.json`, workflow | Usynleg | Låg–middels | **Høg** (to klokker, ny kjøyring, runner-ventetid) | **Fjern** etter nokre veker med AIS: AIS viser om ferja gjekk. ≈ −1 150 linjer og éi driftsflate mindre. |

## 6. Samband, kombirute og korrespondanse

| Funksjon | Kva | Kvar | Bruk | Verdi | Kostnad | Tilråding |
|---|---|---|---|---|---|---|
| Val 1136 / 1135 | To ruter | `Header.jsx`, `prefs.js` 66 | `Route 1136/1135`: tal ukjent | Høg | Låg | **Behald.** |
| Kombirute | Éi samanhengande rute når Fjord1 innfører ho | `build_kombirute.py` 268, `kombirute.json`, `chrome.js` | Dagar det gjeld: ukjent | Høg når ho gjeld | **Høg:** handtranskribert frå PDF kvar gong | **Behald, merk vedlikehaldet.** Gjer visinga eksplisitt (sjå meldingar). |
| Korrespondanse (Solavågen, Hundeidvika, buss 133) | Filter med buss/ferje | `fetch_korrespondanse.py` 243, `korrespondanse.json`, `controls.js` | `Connection solavagen/hundeidvika`: tal ukjent | Middels for ein del | Middels | **Avgjer etter Plausible.** Er bruken låg: flytt til lenkje «Korrespondanse: sjå Entur» i «Om dataa» (≈ −300). |

## 7. Frakopla, installasjon og språk

| Funksjon | Kva | Kvar | Bruk | Verdi | Kostnad | Tilråding |
|---|---|---|---|---|---|---|
| Frakopla (service worker, cache) | Rutetabellen fungerer utan dekning | `sw.js` 175 (vanilla), `web/pwa`, `pwa/register.js` 65, `storage.js` | `Visit pwa`, `PWA first open`: tal ukjent | Høg i fjorden (vurdering) | Middels (versjonering `?v=`) | **Behald.** |
| Installer-knapp og hjelp | Native prompt og hjelp for iOS | `useInstall.js` 60, `InstallDialog.jsx` 66 | `Install app`: tal ukjent | Middels | Låg–middels | **Forenkle:** berre native knapp, ein tekstlinje for iOS (≈ −70). |
| Vakna/online/klokke | Oppdaterer etter søvn og nett | `useWake` 54, `useOnline` 26, `useClock` 41, `useTicker` 32 | Usynleg | Høg | Låg | **Behald.** |
| Språk nn/en/de | Tre språk | `assets/i18n.js` 1 006, `LangSwitch.jsx` 60 | `Language`, `Visit nn/en/de`: tal ukjent | Høg for turistar, vurdering | Middels: kvar streng ×3 | **Behald.** Hald nn som kjelde og en/de som følgjer. Les `Visit de` før de blir halde ved like. |
| Tilgjenge | Skip-link, live-region, aria | `Announcer.jsx` 49, aria-tekstar i core | Usynleg | Høg | Låg | **Behald.** |

## 8. Dei andre flatene

| Funksjon | Kva | Kvar | Verdi | Tilråding |
|---|---|---|---|---|
| Tilbakemelding | Tommel + mailto | `FeedbackDialog.jsx` 98, `chrome.js` | Låg | **Fjern dialogen:** éi mailto-lenkje i foten (≈ −100, og tre hendingar mindre). |
| «Om dataa» og fotnotar | Kjelder, kreditering (NLOD), rekkjefølgje | `Footer.jsx` 84, `Footnote.jsx` 26 | Høg (krav om kreditering) | **Behald.** Dette er staden for alt forklarande. |
| Statistikk (Plausible) | Anonym bruk | `core/track.js` 65, `model/track.js` 67, `components/track.js` 11, ≈ 23 kall | Berre for eigaren, men er grunnlaget for kutt | **Behald, men færre hendingar:** Visit, Route, Day, Messages, Departure detail, Install, Call ferry. Per-kai-hendingar (`From x`, `To x`) gjev lite. |
| Vanilla-appen etter byte | Gamal UI i same repo | `assets/app.js` 2 308, `index.html` 300, `sw.js` 175, `tests/test_web.mjs` 1 236 | Ingen etter byte | **Fjern etter byte til React (≈ −2 800 + ≈ 1 200 testlinjer).** `assets/styles.css` og `i18n.js` blir brukte av React og blir ståande. |
| Dev/preview-hjelparar | `?rute=`, `isPreview`, `sync_dev_data.py` | `chrome.js`, `sync_dev_data.py` 79 | Berre utvikling | **Fjern `/dev/`-flyten** etter byte (≈ −100). |
| Datafangst (GitHub Actions) | Daglege jobbar skriv til `main` | `commit_on_main.py` 214, workflows | Usynleg | **Forenkle** når signalloggen og reserve-meldingane er borte. |

## Det enklaste gode: kva appen kunne innehalde

Éin skjerm, eitt spørsmål: *«Går ferja, og når?»*

1. **Nå:** éin status (AIS-posisjon, «ligg til kai på X» eller «på veg mot Y»), neste avgang og nedteljing.
2. **Dagens avgangar** for valt samband, tidlegare i dag samanfelt. Dagblading.
3. **Banner øvst** når Fjord1 melder avlysing/forseinking, med lenkje til meldinga.
4. **Signaltur-linje** på avgangen det gjeld: «Ring 91 66 93 40 innan kl X».
5. **Val av samband** (1136 / 1135), og kombirute som eksplisitt val ved melding.
6. **Frakopla:** rutetabellen fungerer utan dekning; installer-knapp.
7. **Språk** nn, en (de så lenge det blir brukt).
8. **Foten:** «Om dataa» (AIS frå Kystverket NLOD, Entur, Fjord1), kontakt via mailto.

Ikkje med: frå/til-filter og byt retning, skjul ankomstar, korrespondansefilter, tilbakemeldingsdialog,
installhjelp, avgangsdetalj-dialog, tomflytting-rader, signalloggen, Entur-innsamling, vanilla-UI.

## Prioriterte kutt (grovt estimat, linjer utan testar)

| # | Kutt | Brukareffekt | Linjer | Vilkår |
|---|---|---|---|---|
| 1 | Vanilla-appen og `/dev/`-flyten etter byte til React | Ingen | ≈ −2 900 | Byte gjennomført |
| 2 | Innsamlar: berre AIS (fjern Entur-fangst), worker: berre AIS | Ingen (appen les berre `ais`) | ≈ −1 250 | Avgjer om AIS-mot-Entur-samanlikning skal behaldast |
| 3 | Signalloggen (to klokker, GitHub-jobb, worker) | Låg: ingen «bestilt/ikkje utført»-historikk | ≈ −1 150 | AIS stabil i nokre veker |
| 4 | Meldingar: vis som dei er + avlysingsbanner, eksplisitt kombirute-bytte | Enklare, tryggare | ≈ −300 (≈ −900 med reserve-JSON) | — |
| 5 | Korrespondansefilter → lenkje | Mindre for ein del reisande | ≈ −300 | Plausible `Connection …` viser låg bruk |
| 6 | Dialogar: tilbakemelding → mailto, installhjelp, avgangsdetalj inline | Liten | ≈ −270 | — |
| 7 | Tomflytting-rader og «vis tidlegare» → fotnote/éi rad | Liten | ≈ −175 | — |
| 8 | Frå/til/byt retning/skjul ankomstar → «frå kai» | Middels | ≈ −150 | Plausible `From/To/Swap` viser låg bruk |
| 9 | Statuslinje øvst og «Nå» slått saman | Mindre dobbelt | ≈ −100 | — |
| 10 | Entur-posisjon fjerna (behald avlysing) | Ingen når AIS er stabil | ≈ −150 | AIS stabil |

**Sum ≈ −6 700 linjer av ≈ 19 100 (om lag ein tredel)**, pluss om lag same andel testar. Kutt 1–3 og 10 gjev
≈ −5 450 utan synleg endring for den reisande, og er trygge. Kutt 4–9 rører det brukaren ser, og bør vente på
tala frå Plausible.

## Opne punkt

- Hent tal frå Plausible (Goals) for `From/To/Swap`, `Connection …`, `Departure detail`, `Show past`, `Install app`,
  `Messages …`, `Visit de/en`, `Visit pwa`, `Call ferry` før kutt 4–8 blir gjorde. Eg har ikkje tilgang til dei.
- Kutt 1 gjeld først når produksjon (`ruter.trandal.org`) er flytta til React-appen; i dag er prod framleis den gamle appen.
