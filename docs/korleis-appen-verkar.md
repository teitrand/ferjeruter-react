# Korleis Fergeorakelet hentar, sjekkar og set saman informasjon

Dette dokumentet skal vere nok til å byggje appen opp att. Det skildrar kva kvar kjede er, kva som blir lagra, kva som blir rekna ut i nettlesaren, og kva som *ikkje* er bevis.

Klokka er alltid veggtid i `Europe/Oslo`. Datoar er `YYYY-MM-DD` i den sona. Avgangar i JSON er `HH:MM:SS`.

Appen heiter Fergeorakelet. Ho er ei statisk side på GitHub Pages. Entur med open CORS blir spurt frå nettlesaren. Fjord1-trafikkmeldingar kjem frå ein Cloudflare Worker med CORS (`cloudflare/trafikkmeldinger/`), med `data/trafikkmeldinger.json` som reserve. GitHub Actions skriv JSON-filene.

## 1. Kva sida viser

To samband, éi ferje om gongen:

| Kode | Samband | Kjelde |
| --- | --- | --- |
| 1136 | Standal–Trandal–Sæbø–Skår, og nokre dagar Valderøya–Store Kalvøy | Entur `MOR:Line:1136`, lagra i `data/ruter.json` |
| 1135 | Sæbø–Leknes | Entur `MOR:Line:1135`, same fil |
| kombi | Sæbø–Leknes–Skår–Trandal–Standal som éi rute | Transkribert frå FRAM-PDF til `data/kombirute.json`. Ligg ikkje i Entur |

Kaien Lekneset hos Entur blir normalisert til Leknes.

Heimkai er fyrste `from` i dagen, i praksis Standal. Ferja flyttar seg ikkje utan passasjerar mellom kaiene i Hjørundfjorden. Den einaste tomturen er mellom Valderøya/Store Kalvøy og Hjørundfjorden, 120 minutt (AIS, om lag 110–125), deretter ligg ho til kai. Den turen står ikkje i Entur. Etter siste passasjertur på Valderøya eller Store Kalvøy går ho slik heim til Standal. Endar dagen på ein kai i fjorden, ligg ho der.

Ordlyden «utan passasjerar» (statuslinja, «No»-kortet og «Flyttar seg»-rada i tidslinja) blir berre brukt for turar til og frå Valderøya (`isNoPassengerTrip`), der passasjerar ikkje har lov til å vere med. Alle andre turar og flyttingar, også heimturen Trandal → Standal om kvelden (ein avlyst retur som ferja likevel køyrer), får vanleg tekst: «Ferja er på veg mot Standal». Tida for tomturen (120 min) er uendra.

Fartya som er namngjevne i meldingar og kombirute er M/F Geiranger (916 69 321) og M/F Kvernes (916 69 340, MMSI 257297400). Signaltur-telefonen i ruteheftet er 91 66 93 40.

## 2. Filer ein må ha

```
index.html              skalet, cache-bust ?v=
assets/app.js           all oppførsel
assets/i18n.js          nn, en, de
assets/styles.css
sw.js                   service worker
manifest.webmanifest
data/ruter.json         1136 og 1135
data/kombirute.json     kombinasjonsruta
data/korrespondanse.json
data/trafikkmeldinger.json
data/signalturar.json   sju dagar med bestilt / ikkje utført
scripts/fetch_ruter.py
scripts/fetch_korrespondanse.py
scripts/fetch_trafikkmeldinger.py
scripts/build_kombirute.py
scripts/log_signalturar.py
.github/workflows/      cron og deploy
tests/                  node:test og unittest
```

`?v=` på `app.js`, `i18n.js` og `styles.css` må vere det same talet i `index.html`, `sw.js` (både cache-namn `fergeruter-vN` / `fergeruter-dev-vN` og precache-URL-ar) og importen i `app.js`. Testane i `tests/test_sw.mjs` og `tests/test_plausible.mjs` låser talet. Når JS eller CSS endrar seg, auk talet i alle desse samstundes. Gamal service worker slepper elles ikkje den nye fila.

## 3. Skjema

### `data/ruter.json`

Skriven av `scripts/fetch_ruter.py`.

- `source`, `fetchedAt`
- `hjorundfjordQuays`: kaier i Hjørundfjorden. Tur mot Valderøya/Store Kalvøy er tomflytting utan passasjerar. PDF-en frå 17.08.26 har fotnote 1) og 3), ikkje ein eigen fotnote for tomturen
- `lines["1136"]` og `lines["1135"]`: `lineId`, `publicCode`, `lineName`, `legs[]`

Kvart bein:

| Felt | Meining |
| --- | --- |
| `id` | `MOR:ServiceJourney:…#0`. Same id blir brukt att kvar dag ruta går. `#0` blir strippa før samanlikning |
| `from`, `to` | Kai utan «ferjekai» / «kai» |
| `departure`, `arrival` | `HH:MM:SS` |
| `activeDates` | Datoane beinet gjeld. Filtrering er medlemskap, ikkje vekedag |
| `signal` | `null`, eller `{ minutesBefore, text, phone }` |
| `notices` | Fritekst frå Entur |
| `requestStop` | Entur sitt flagg. Signaltur i denne appen kjem frå PDF-lista under, ikkje frå dette flagget åleine |

Signaltur blir sett av `PDF_SIGNAL_1136` i `fetch_ruter.py`, fotnote 1) og 3) i FRAM-PDF for 1136 (17.08.26). Nøkkelen er daggruppe (`mtthf`, `wednesday`, `saturday`, `sunday`), frå-kai og avgang `HHMM`. 1) er 60 minutt, 3) er 180. Telefonen er 91 66 93 40. Eit bein som ikkje står i den lista er ikkje signaltur, sjølv om Entur-notisen seier noko anna. Standal 07:40 er vanleg rute; Trandal 08:00 laurdag på same omløp kan vere signal.

### `data/kombirute.json`

Skriven av `scripts/build_kombirute.py` frå ein hardkoda transkripsjon av FRAM-PDF (per no 18.11.25). Ikkje parse PDF i CI. Ved ny PDF: oppdater kjelde-URL og transkripsjonen, køyr skriptet, sjå at testane i `tests/test_kombirute.py` stemmer.

- `crossingMinutes`: overfartstid per par, t.d. `"Sæbø–Leknes": 15`
- `legs[]` har `days` (`weekday`, `saturday`, `sunday`) i staden for `activeDates`. Offisiell norsk høgtidsdag som fell på kvardag eller laurdag (1. nyttårsdag, skjærtorsdag, langfredag, 2. påskedag, 1. mai, 17. mai, Kristi himmelfartsdag, 2. pinsedag, 1. og 2. juledag) bruker `sunday`, jf. «Søndagsruter på andre helge- og høgtidsdagar» i FRAM-PDF-en. 1136 og 1135 bruker `activeDates` frå Entur og blir ikkje påverka
- `signal` er ofte `null` på kombibeina. PDF-notisen er «berre på signal seinast 1 time før», men loggen i `signalturar.json` tek berre bein frå `ruter.json` som har `signal` og `activeDates`

Neste fylte celle i PDF-en er neste stopp. Ankomst = avgang + overfartstid. Éi ferje, éi samanhengande rute. Overlappande signalturar i PDF-en (Skår og Leknes samstundes) er ikkje tomflytting.

### `data/korrespondanse.json`

Skriven av `scripts/fetch_korrespondanse.py` frå Entur.

- Solavågen og Hundeidvika via Festøya–Standal (samband 1049 er vegen ut av fjorden, men styrer ikkje 1136-tabellen)
- Buss 133 Leknes–Øye blir vist når aktiv tabell har Leknes (1135 eller kombi)

### `data/trafikkmeldinger.json`

Skriven av `scripts/fetch_trafikkmeldinger.py` frå Fjord1 sitt Ibexa-view `https://www.fjord1.no/api/ezp/v2/views`. Det gamle GraphQL-endepunktet på `www.fjord1.no` svarar 404 og blir ikkje brukt. Sida `https://www.fjord1.no/trafikkmeldingar` er menneske-kjelda. Same viewet blir òg lesen av Cloudflare-workeren, som nettlesaren spør når denne fila er gammal.

Melding:

| Felt | Meining |
| --- | --- |
| `id` | Fjord1-id, eller `live:` + hash når ho kjem frå nettlesaren |
| `heading`, `text` | Originalspråk, ikkje omsett |
| `publishedAt`, `validFrom`, `validTo` | ISO |
| `connectionNumber` | 132 er 1136, 134 er 1135 |
| `isLocal` | Treff på 1136/1135/1049 eller stadnamn i Hjørundfjorden / Festøya |
| `routeMode` | `1136`, `1135` eller `kombi`, sjå avsnitt 6 |
| `isRouteControl` | Om meldinga får lov å byte tabell |
| `kind` | `cancelled`, `delay`, `normal`, `capacity`, `info` |

Jobben på `main` (`.github/workflows/update-trafikkmeldinger.yml`) committer berre når innhaldet er endra. Push går gjennom `scripts/commit_on_main.py`: blir han avvist fordi ein annan jobb rakk å skrive til `main` først, blir committen rebasa og prøvd på nytt. Same skriptet blir brukt av rutetabell-jobben og av testhost-sync. Kollisjon i fila blir kasta, og hentinga køyrd om att oppå siste `main`. `fetchedAt` blir derfor ståande mellom endringane og er ikkje eit teikn på at jobben nett har køyrd. GitHub sin `*/5`-cron er reserve for fila og blir ofte køyrd berre nokre gonger i døgnet. Cloudflare-workeren `cloudflare/trafikkmeldinger/` svarar JSON med CORS til nettlesaren og startar ikkje denne jobben. `dev` skal ikkje overskrive denne fila. Testhosten les produksjonsfila. Oppsett: `cloudflare/trafikkmeldinger/README.md`.

### `data/signalturar.json`

Skriven av `scripts/log_signalturar.py` på `main`, kvar halvtime i vaktvindauget 04:00–22:40 UTC. Workflow: `.github/workflows/log-signalturar.yml`. Skriptet som hentar `main`, loggar og pushar er `scripts/signaltur_loop.py`.

Klokka er ein Cloudflare Worker på gratisplanen, `cloudflare/signaltur-cron/`. Cron Trigger der er `7,37 4-21 * * *` (UTC). Kvart slag kallar GitHub REST og startar workflowen med `workflow_dispatch` på `main`. Tokenet er ein fine-grained PAT med berre dette repoet og Actions les og skriv, lagra som løyndommen `GITHUB_TOKEN` på workeren. Oppsett står i `cloudflare/signaltur-cron/README.md`.

GitHub-cron med same minutt er reserve. `:07` og `:37` ligg utanfor den travlaste cron-køen på `:00` og `:30`. Siste slag er 21:37 UTC (23:37 norsk sommertid, 22:37 vintertid), inne i vaktvindauget som sluttar 22:40 UTC. `22:07` UTC er 00:07 i Oslo i sommar og blir ikkje brukt, for då blir neste dag logga tom. Siste signaltur 20:20, framme 20:35 Oslo, ligg før neste slag både i sommar (18:37 UTC) og vinter (19:37 UTC). `concurrency` med gruppa `log-signalturar` held éin køyring om gongen. Er `updatedAt` yngre enn 20 minutt, hoppar jobben over, så worker og reserve ikkje skriv dobbelt. Manuell køyring kan setje `force` for å logge likevel.

Push til `main` går gjennom `scripts/commit_on_main.py`, same hjelparen som trafikkmeldingar, rutetabell og testhost-sync. Vinn ein annan jobb kappløpet, blir committen rebasa og push prøvd på nytt. Kollisjon i `signalturar.json` blir kasta, og loggen blir skriven på nytt oppå siste `main`.

GitHub kan la jobben stå utan runner. Etter om lag 15 minutt avbryt plattforma ho og merkjer workflowen som failure, med teksten «The job was not acquired by Runner of type hosted even after multiple attempts». Ingen steg har køyrt, `runner_id` er 0, og det er ikkje concurrency-gruppa som avbryt: førre køyring er ferdig, og neste slag er eit halvtime seinare. Workeren sjekkar etter 15 sekund. Har jobben framleis ingen runner etter 12 minutt, avbryt han køyringa og startar **same** køyring på nytt (`rerun`). Då blir det ikkje ein ekstra workflow-run, og det nye forsøket kan bli grønt. `concurrency` held framleis éin logger om gongen, så reserve-cronen ikkje skriv dobbelt. 12 minutt er valt fordi ei treg men vellukka køyring 5. oktober 2026 venta drygt 10 minutt på runner. Dette verkar fyrst etter at workeren er deploya på nytt (`npx wrangler deploy` i `cloudflare/signaltur-cron/`). Sjølve workflow-fila på `main` endrar ikkje denne vakta.

Kvar runde ser på **alle** signalturar i dag som har passert tingefristen, òg dei eit hol hoppa over. Turane blir fylte inn frå det Entur enno svarar. Avlyst blir `skipped` òg etter ankomst. `booked` krev `actualDepartureTime`: at kallet berre ligg i feeden utan avlysing etter fristen er ikkje tinging, for avlysinga kan kome etterpå. Utan faktisk avgang blir det ikkje skrive `booked`, heller ikkje før ankomst. `observedAt` er den faktiske avgangen, og rada får `evidence: "departed"`. Unntaket er ein tom uttur som berre går så ein seinare retur med faktisk avgang kan køyre (t.d. 06:45 Standal→Trandal før bestilt 07:05 tilbake). Då er statusen `gått`: ferja segla, utan bestillingsbevis. Er returen enno ikkje avgjord, blir utturen ikkje skriven som `booked`. Er kallet borte frå feeden, blir det ikkje gjetta. Spørjinga les dagen side for side om Entur berre gir 40 kall om gongen.

Start, etter at workflowen ligg på `main`: følg `cloudflare/signaltur-cron/README.md` (`npx wrangler login`, `npx wrangler secret put GITHUB_TOKEN`, `npx wrangler deploy`). Reservecronen på GitHub startar av seg sjølv når fila ligg på `main`. For å stoppe: slå av cron på workeren og slå av workflowen (Actions → Logg signalturar → Disable workflow).

`updatedAt` er hjarteslaget. Skriptet skriv det kvar gong, så eit commit betyr at sjekken køyrde. Mellom 04:00 og 22:40 UTC er loggen for sein om det er meir enn 70 minutt sidan siste skriving. Alderen blir rekna frå `updatedAt`, eller frå 04:00 UTC same dag om nattpausen er lengre, så den fyrste morgonkøyringa ikkje blir sein berre fordi jobben stod stille om natta. Etter 22:40 UTC er det planlagt pause. Når loggen er for sein, viser statuslinja ein åtvaring. Observasjonar som alt er gjort i tide tel framleis. Ein sein `updatedAt` stoppar ikkje jobben: ho varslar og skriv loggen likevel.

```json
{
  "keptDays": 7,
  "updatedAt": "2026-10-02T01:17:20+02:00",
  "days": {
    "2026-10-01": [
      {
        "id": "MOR:ServiceJourney:1136_102_9150000047474169",
        "from": "Standal",
        "to": "Trandal",
        "departure": "06:45:00",
        "status": "booked"
      }
    ]
  }
}
```

`status` er `booked`, `skipped` eller `gått`. `booked` og `gått` som kjem frå faktisk avgang har `evidence: "departed"`. `observedAt` er då avgangstida, ikkje når nokon ringde. `skippedAt` kjem om ein tur seinare blir avlyst. Sju dagar medrekna i dag. Eldre datoar blir sletta. Ein tur som først er `skipped` blir aldri skriven om til `booked`. Han kan bli `gått` om ferja likevel segla som tomtur for ein bestilt retur. `booked` utan `evidence` er eit gammalt gjett og blir fjerna neste runde om vi ikkje stadfestar avgang. Stadfesta `booked` kan bli `skipped` om eit seinare svar viser avlysing, men ikkje `gått`. `gått` blir ståande. `observedAt` på ein stadfesta tur blir ståande.

Entur har berre driftsdagen. Dagar før loggen starta kan ikkje fyllast inn. Første observasjon som betyr noko er etter tingefristen. At turen ligg i `estimatedCalls` utan avlysing er ikkje bevis på bestilling. At turen manglar i feeden er heller ikkje bevis (avlysinga dett ut etter ei stund, og fullførte turar dett òg ut). Eit hol same dag blir fylt inn berre når Entur enno har avlysing eller faktisk avgangstid.

## 4. Entur: rutetabell

`fetch_ruter.py` spør `https://api.entur.io/journey-planner/v3/graphql` med header `ET-Client-Name: teitrand-fergeruter`.

Spørjinga hentar `line(id)` for `MOR:Line:1136` og `MOR:Line:1135`: service journeys, kall, kai, tid, notisar. Skriptet

1. strippar «ferjekai» / «kai» og byter Lekneset → Leknes
2. merkar signal berre når frå-kai, klokkeslett og daggruppe står i `PDF_SIGNAL_1136`
3. legg `activeDates` frå kalenderen til journeyen
4. skriv fila berre som ein heil erstatning

Køyr manuelt, eller workflow **Oppdater rutetabell**. Ho går kvar natt (`20 4 * * *` UTC) på `main`, og kan òg startast med `workflow_dispatch`. Fila blir berre skriven når innhaldet er endra. Nettlesaren les fila. Han spør ikkje Journey Planner for sjølve tabellen.

Korrespondanse blir henta i same workflow av `fetch_korrespondanse.py`.

## 5. Entur: sanntid (SIRI VM)

Nettlesaren, berre medan fana er synleg og klokka er innanfor rutevindauget ± 30 minutt:

```
https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1136
https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1135
```

1136 blir spurd fyrst. 1135 berre om 1136 ikkje gav fersk posisjon. I kombimodus blir sanntid brukt berre om Kvernes rapporterer.

Eit svar er ferskt i 3 minutt (`LIVE_MAX_AGE_MS`). Poll kvart 55. sekund. Feil doblar backoff frå 1 minutt opp til 15. Skjult fane hentar ikkje.

Frå VehicleActivity blir det trekt ut: `journeyRef`, destinasjon (lista blir kutta til neste kjende kai), forseinking (`PT…` eller sekund), posisjon, `atStop`, stoppnamn, `originAimed`, faktisk avgang.

Posisjon nærare enn 250 m frå kai-koordinata i `QUAY_COORDS` reknast som liggjande ved den kaia. Koordinata (0,0) blir forkasta.

`leftOrigin`:

- faktisk avgangstid → har lagt frå, men ikkje når ferja står langt frå strekninga (då er ho ikkje på turen)
- `atStop` på startkaien → ligg
- `atStop` på endekaia → har lagt frå
- `atStop` på ei anna kai → ukjent: ferja er ein tomtur eller ligg til kai, og Entur kan ha kopla ho til turen på førehand
- meir enn 250 m frå startkaien og på strekninga (`nearLeg`) → har lagt frå; langt frå strekninga → ukjent
- elles ukjent

Ein signaltur blir aldri «bestilt» eller «gått» av at Entur har tilordna ferja til turen. Det krev avgang frå startkaien eller ferja på strekninga/ved endekaia etter rutetida. Feilen 10. oktober 2026 (1136 låg ved Standal, turen 12:15 Valderøya → Store Kalvøy vart vist som bestilt) kom av at `atStop` på ei anna kai tel som avgang. Hugsa turar ligg under `fergeruter-sailed-v2` så gamle feilhugsingar blir kasta.

Forseinking blir lagt på vanleg rute, og på signaltur berre når ferja faktisk har lagt frå kai. Ein signaltur som ikkje går skal ikkje få «40 min forsinka».

Små ferjer manglar ofte i VM, særleg utanom rutetid. Då gjeld tabellklokka.

## 6. Fjord1: trafikkmeldingar og kva tabell som gjeld

### Innhenting

Vi bruker ein Cloudflare Worker, ikkje GitHub-cronen, som den ferske vegen. Fila på GitHub blir berre skriven når meldingsteksten endrar seg, og Pages bruker tid på å publisere. Då ville nettlesaren framleis rekne kopien som gammal etter åtte minutt og gå til `r.jina.ai` om cronen var einerådande. Workeren les Ibexa direkte og svarar med CORS. `r.jina.ai` er siste utveg om workeren feilar.

1. Cloudflare-workeren `cloudflare/trafikkmeldinger/` hentar Ibexa-viewet og svarar JSON. Kant-cachen er 2 minutt. Nodane har same form som `normalizeFjord1Node` ventar. Klassifiseringa skjer i nettlesaren.
2. GitHub Actions skriv `data/trafikkmeldinger.json` på `main` når innhaldet er endra. GitHub sin `*/5`-cron er berre reserve for den fila. Workeren har ingen cron.
3. Nettlesaren hentar fila kvart 3. minutt (`cache: no-cache`). Testhost `/dev/` hentar produksjons-URL (`…/fergeruter/data/trafikkmeldinger.json`), ikkje kopien under `/dev/`.
4. Er `fetchedAt` eldre enn 8 minutt, eller fila manglar, spør nettlesaren workeren. Svaret er `complete`, så haldne meldingar blir fletta inn og ikkje berre lagde oppå.
5. Svarer ikkje workeren, blir HTML-sida `https://www.fjord1.no/trafikkmeldingar` lesen via `https://r.jina.ai/`. Nye meldingar blir fletta inn på `heading|text` og får id `live:…`. Dei blir òg lagra i `localStorage` (`fergeruter-messages-v1`) slik at kombirute kan visast før nettverket svarar.

### Klassifisering av tekst

Same uttrykk i Python og JS:

| Treff | `kind` / modus |
| --- | --- |
| `innstilt` og `normal drift`, utan kombi | `normal` / tabell 1136. «Normal drift» vinn over eit laust «innstilt» |
| `kombinasjon`, `kombirute`, `kombinert rute`, eller både 1135 og 1136 innstilt | `kombi` |
| 1136 innstilt, ikkje 1135, og teksten er ikkje berre eit utval av avgangar | heile tabellen blir 1135 |
| utval (`følgjande avgangar`, `avgangar innstilt`, `avgang kl.`) | blir på 1136, og dei nemnde avgangane blir merkte innstilte |
| berre 1049 / Festøya / Hundeidvika | styrer ikkje tabellen |
| `forsink` | `delay` |
| `kapasitet`, `farleg last` (òg skrivefeilen kapasitet) | `capacity` |

Nyaste gyldige lokale melding styrer. Gyldigheit som er «heile døgnet» hos Fjord1 blir halden ut Oslo-dagen. Tekst som seier «òg på laurdag» kan halde kombirute etter CMS-`validTo`. Datoar i teksten (òg nynorsk vekedag) avgrensar vindauget. «Normal drift frå klokka HH:MM» byter tilbake same dag, ikkje dagen før.

`?rute=1136|1135|kombi` og `?frå=` verkar berre på localhost og `/dev/`. Produksjon ignorerer dei.

Ved normal drift vel brukaren 1136 eller 1135. Valet ligg i `localStorage` (`fergeruter-route-choice`). Når meldinga tvingar 1135 eller kombi, visest den tabellen i begge sambanda.

Enkilde avgangar som er innstilte i teksten blir `fra-kai|HH:MM:SS` i eit sett. Dei får raud «Innstilt» og blir tekne ut av «kvar er ferja».

## 7. Entur: avlysing og om ein signaltur er bestilt

Entur har ikkje eit felt «bestilt». Det som finst er `cancellation: true` på `estimatedCalls` i Journey Planner, og nokre gonger ein kort SIRI-SX-tekst «Bestilling ikke mottatt». SX-teksten gjeld berre i tidsvindauget til turen og blir ikkje brukt som kjelde. Avlysinga i GraphQL varer lenger, men dett òg ut. Situasjons-id i SX og ET er ikkje dei same og skal ikkje koplast.

Nettlesaren spør, samstundes med VM:

```
query Cancelled($start: DateTime!) {
  s0: stopPlace(id: "NSR:StopPlace:…") {
    estimatedCalls(
      startTime: $start
      timeRange: 86400
      numberOfDepartures: 40
      includeCancelledTrips: true
      whiteListed: { lines: ["MOR:Line:1136", "MOR:Line:1135"] }
    ) { cancellation aimedDepartureTime actualDepartureTime serviceJourney { id } }
  }
}
```

`$start` er midnatt i Oslo for i dag. Stoppa er frå-kaiane på dagens bein som finst i `STOP_PLACES` (Standal 39713, Trandal 58521, Sæbø 58765, Skår 41385, Leknes 58766, Valderøya 61752, Store Kalvøy 58525).

To mengder blir lagra:

- `cancelledJourneys`: `cancellation: true`
- `seenJourneys`: alle id-ar i svaret
- `actualDepartures`: `actualDepartureTime` når Entur har han

Service journey-id blir brukt på fleire datoar. Avlysingsmengda gjeld berre i dag. Ein vanleg tur som er avlyst i dag får «Innstilt». Ein signaltur som er avlyst får «Ikkje utført», ikkje «Innstilt». Setninga «Ferja har ikkje lagt frå kai» kjem berre når sanntid viser at ho framleis ligg ved frå-kaien etter avgangstid. Avlysing hos Entur før avgang, utan den posisjonen, er ikkje det same. Avlyste bein blir tekne ut av `runningLegs`, så «No»-linja ikkje seier at ferja er på veg på ein tur som ikkje går.

### Når etiketten er «Bestilt signaltur»

Grøn etikett (`signal.booked`, CSS `--ok` / `.stop-tag-booked`). Før fristen står det alltid «På signal» med `tel:` til 91 66 93 40.

For **i dag**, etter fristen (`avgang − minutesBefore`):

1. Loggen seier `skipped`, eller Entur har `cancellation` → ikkje bestilt. Sein avlysing vinn over eit tidlegare `booked`.
2. Sanntid seier at denne turen ikkje la frå kai, eller at ein seinare tur er den som blir køyrd, → ikkje bestilt («Ikkje utført»), med mindre vi alt har avgangsbevis som seier at ho gjekk.
3. Avgangsbevis: loggen seier `booked` med `evidence: "departed"`, Journey Planner har `actualDepartureTime`, eller sanntid viser at denne turen har lagt frå kai. Utan det er turen ikkje bestilt. At kallet ligg i svaret utan avlysing er ikkje bevis, korkje før eller etter avgang.
4. Ein tom uttur for ein seinare retur som sjølv har avgangsbevis er `gått`, ikkje bestilt. Er returen enno ikkje avgjord, viser vi heller ikkje bestilt.
5. Har vi sett faktisk avgang i økta, blir id-en hugsa i `confirmedBooked` til Entur avlyser. Eit ope kall blir ikkje hugsa.

Etter fristen, utan avgangsbevis, er turen usikker. Då er statusen den same som om ho ikkje var bestilt: «Ikkje utført», og ho blir teken ut av rekninga av kvar ferja er. Før fristen står det framleis «På signal». Vi skriv ikkje at Entur har avlyst turen når vi berre manglar bevis. Har ferja faktisk gått, men returen kan gjere turen til ein tomtur, seier vi ikkje «Ikkje utført» og ikkje «Bestilt».

Om hjarteslaget i loggen er for seint (sjå `updatedAt` under `data/signalturar.json`), seier statuslinja frå. Vi merkjer ikkje ein tur bestilt berre fordi sjekken manglar. Berre avgangsbevis tel, anten det står i loggen eller i eit ferskt Entur-svar.

Eit trykk på avgangen opnar eit vindauge. Der står korleis signalturen verkar, telefonnummeret, og om vi reknar turen som bestilt. Teksten seier at Entur ikkje oppgjev når bestillinga kom inn, berre at ferja har faktisk avgangstid. Om loggen har `observedAt`, visest det tidspunktet som «vi registrerte det fyrste gong». Vindauget seier òg at den som tinga kan gjere om, og at Entur då kan avlyse, så ein bør ringje sjølv om ein vil vere sikker.

Økta held på merkelappen når vi har sett faktisk avgang. Eit svar som berre seier «ikkje avlyst» blir ikkje grøn etikett.

For **ein annan dag** finst ikkje dagens avlysingsmengd. Berre loggen: `booked` med `evidence: "departed"` → grøn etikett og «Gått». `booked` utan det beviset tel ikkje. `gått` → «Gått» utan grøn etikett og utan «Ikkje utført» (ferja segla, men vi har ikkje bestillingsbevis). Alt anna → «Ikkje utført». Usikkert blir ikkje «På signal» og ikkje «Gått».

### Når «No»-linja seier at signalturen går

`signalVerdict`:

- annan dag: `skipped` når loggen ikkje har ein `booked` med `evidence: "departed"` og ikkje `gått`. `gått` er ikkje `skipped`
- i dag, fersk posisjon, same tur, har lagt frå kai → `running` (òg om Entur har avlyst, dersom båten faktisk gjekk)
- etter fristen utan avgangsbevis → `skipped`. Det gjeld òg før avgang. Eit ope kall utan avlysing er ikkje avgangsbevis
- avlyst i dag, eller logg `skipped`, og posisjonen ikkje viser avgang → `skipped`
- etter avgangstid, fersk posisjon, framleis på startkaien → `skipped`
- ein seinare tur er den VM følgjer → denne signalturen er `skipped`, med mindre ho har avgangsbevis. Eit ope kall gjer ikkje utturen 06:45 om til bestilt berre fordi returen 07:05 går. Har utturen gått og returen òg, er utturen ein tomtur og ikkje «Bestilt»
- elles ingen dom. Då gjeld tabellklokka

`sailingDoneAt`: ein `skipped` signaltur i dag er ferdig ved avgangstid, så han dett ut av den synlege lista når «tidlegare avgangar» er skjult.

## 8. Korleis «No» blir rekna ut

`currentStatus`:

1. `ferryStatus` på `runningLegs` (utan innstilte og utan avlyste).
2. Før fyrste avgang: ligg på frå-kaia.
3. Mellom avgang og ankomst: «på veg mot {kai}». Framdrift er lineær mellom klokkesletta.
4. Mellom ankomst og neste avgang på same kai: «ligg til kai». Opphald på minst 20 minutt er liggetid (matpause), med eigen tekst.
5. Mellom ankomst og neste avgang på ein annan kai: tomflytting berre mellom Valderøya/Store Kalvøy og Hjørundfjorden, 120 minutt. Deretter ligg ferja til kai på neste kai (Standal på veg inn, Valderøya før passasjeravgangen på veg ut) til avgangen. Er holet kortare enn 120 minutt, varer tomturen heile holet. Eit hol mellom Standal, Trandal, Sæbø og Skår er ikkje tomtur. Ferja ligg på kaia ho sist kom til.
6. Etter siste ankomst: ferdig på den kaia om det er heimkai eller kombi. Frå Valderøya eller Store Kalvøy: tomtur heim i 120 minutt, deretter kai på Standal. Frå ein kai i fjorden: ferdig der, utan tomtur heim.
7. Om VM er fersk: signaltur som har lagt frå kai overstyrer med destinasjon og forseinking, heilt til ho er framme. Framme er `VehicleAtStop` på `leg.to`, eller planlagd/forventa ankomst er passert utan at VM seier at ho er ein annan stad. Då gjeld same kai-tekst som tabellen: «ligg til kai» med liggetid og neste avgang. Signaltur som ikkje har lagt frå kai overstyrer med «ikkje utført». Vanleg rute får forseinking lagt på tabellteksten.

Filtra frå/til endrar kva rader som visest, ikkje kvar ferja er. Reise med mellomstopp følgjer same ferje. Skår→Standal går via Sæbø/Trandal. Leknes→Standal i vanleg rute byter ferje på Sæbø og får ventetid. Korrespondanse blir merkt på avgang og ankomst, ikkje som eigne rader. Fyrste avgang i reisa står i hovudlinja. Seinare bein og venting på knutepunktet får klassen `stop-onward` og er innrykka, så dei ikkje ser ut som avgangar frå startkaien.

## 9. Nettlesaren

Oppstart i `assets/app.js`:

1. språk (`fergeruter-lang-chosen`, elles `navigator.languages`; `no`/`nb`/`nn` → nynorsk)
2. service worker
3. `loadMessages`, `loadRoutes`, `loadSignalLog`
4. minutt-tikk som oppdaterer nedteljing og sanntid

Rutetabellen blir òg lesen frå `localStorage` (`fergeruter-timetable-v1`) med ein gong, så sida verkar utan nett. Fingeravtrykket ignorerer `fetchedAt` på meldingar, men ser innhaldet.

Service worker (`sw.js`):

| Filer | Strategi |
| --- | --- |
| `ruter.json`, `kombirute.json`, `korrespondanse.json` | stale-while-revalidate, varslar klienten om tabellen er ny |
| `trafikkmeldinger.json` | network-first, varslar `messages-updated` |
| `signalturar.json` | network-first, utan varsel |
| html, css, js | network-first |
| resten | stale-while-revalidate |

Cache-nøkkelen for `/data/` droppar `?t=`. `/dev/` har eige cachenamn `fergeruter-dev-vN`, så testhosten ikkje skriv over produksjon.

Plausible blir ikkje lasta på localhost eller `/dev/`. Hendingar og eigenskapar står i README. Ingen informasjonskapslar.

Tilbakemelding går til `mailto:teitrand@hotmail.com` og GitHub Issues. Det blir ikkje lagra i appen.

PWA: `manifest.webmanifest`, installer-knapp, rettleiing der nettlesaren ikkje har `beforeinstallprompt`. Ingen push. Det krev tenar.

## 10. Deploy

`main` er produksjon: https://teitrand.github.io/fergeruter/

`dev` er testhost: https://teitrand.github.io/fergeruter/dev/

Pages-miljøet godtek berre `main`. Derfor:

1. Feature-grein frå `dev`. PR mot `dev`. Aldri feature-PR mot `main`.
2. Workflow **Publiser testhost til /dev/** kopierer `dev` inn som mappa `dev/` på `main` (`rsync`, utan `.git`, `.github` og `dev`).
3. Når testhosten er grei: kopier rotfilene frå `dev` til `main` (index, assets, scripts, tests, workflows, nye datafiler). Ikkje merg `main` inn i `dev`. `main` inneheld `dev/`-mappa, og ein merge ville lagt den mappa inn på `dev`.
4. Ikkje kopier `data/trafikkmeldinger.json` frå `dev` til `main`. Produksjon si fil er nyare, fordi jobben berre skriv på `main`. Det same gjeld `data/signalturar.json` etter at loggen har begynt å gå: ta med fila fyrste gong ho blir innført, og la jobben på `main` eige ho etterpå.

`pages.yml` kan setje saman både rot og `/dev/` om Pages blir bytt til GitHub Actions. Til dess publiserer GitHub si innebygde Pages-kjelde frå `main`, og `dev/`-mappa er testhosten.

## 11. Testar

CI (`.github/workflows/test.yml`) på kvar push og PR:

```bash
python -m unittest discover -s tests -v
node --test --test-concurrency=1 \
  tests/test_status.mjs tests/test_i18n.mjs tests/test_plausible.mjs \
  tests/test_route_mode.mjs tests/test_sw.mjs tests/test_signaltur_cron.mjs \
  tests/test_trafikkmeldinger_worker.mjs
```

Python-testar lastar skript med `importlib` frå filsti. `unittest discover` har `tests/` på `sys.path`, så `import scripts.…` verkar ikkje.

Det som må halde:

- Tabellbyte frå meldingstekst, inkludert delvis innstilling, nynorsk dato, og at 1049 ikkje styrer 1136
- Signaltur som ligg til kai etter avgang er ikkje utført. Signaltur som har lagt frå kai er på veg, med forseinking. Avlyst signaltur før avgang får «Ikkje utført» utan «har ikkje lagt frå kai»
- Avlyst kveldssignaltur 20:00/20:20 gjer ikkje «på veg mot Standal» når ferja ligg der
- Etter fristen er turen bestilt berre med avgangsbevis (`actualDepartureTime`, sanntid som har lagt frå kai, eller logg `booked` med `evidence: "departed"`). Ope kall utan avlysing er ikkje bestilt. Sein `cancellation` vinn over tidlegare bestilt
- Etter ankomst: bestilt berre om avgangsbeviset enno gjeld. Manglande avlysing er ikkje bevis
- Logg `skipped` blir ikkje bestilt att, heller ikkje om Entur har gløymt avlysinga
- Loggen viser bestilt og ikkje utført på ein tidlegare dato
- Signallogg eldre enn 70 minutt mellom 04:00 og 22:40 UTC er for sein. Utanfor vindauget, og rett etter 04:00 når førre køyring var kvelden før, er ho ikkje for sein
- Kombirute-transkripsjonen stemmer med byggaren
- Høgtidsdag i kombirute bruker søndagstabellen
- Tomtur berre Valderøya/Store Kalvøy ↔ Hjørundfjorden, 120 minutt, deretter kai. Hol inne i fjorden er kai
- Etter tingefristen utan bevis på bestilling: «Ikkje utført», og turen flyttar ikkje ferja
- Cache-versjonen i SW, HTML og JS er den same

## 12. Byggje opp att

1. Statisk `index.html` som lastar `assets/app.js?v=N` som modul og `assets/i18n.js`.
2. Legg inn dei tre tabellfilene. Køyr `fetch_ruter.py` og `fetch_korrespondanse.py` mot Entur med `ET-Client-Name`. Bygg kombirute frå PDF-transkripsjonen, ikkje frå Entur.
3. Implementer Oslo-klokke, `activeDates` / `days`, og `ferryStatus` som i avsnitt 8.
4. Hent Fjord1 til JSON via Ibexa, ikkje GraphQL. Klassifiser med uttrykka i avsnitt 6. La nyaste lokale melding velje 1136, 1135 eller kombi. Delvis innstilling merkar rader, ho byter ikkje tabell. Fersk veg i nettlesaren er workeren i `cloudflare/trafikkmeldinger/`. `r.jina.ai` er siste utveg.
5. Poll SIRI VM i rutevindauget. Stol på posisjon berre i 3 minutt. Rekn avgang frå `leftOrigin`.
6. Poll GraphQL-avlysingar for dagen. Ta avlyste bein ut av posisjonsrekninga. Signaltur som er avlyst er «Ikkje utført».
7. Etter tingefristen: grøn «Bestilt signaltur» berre etter reglane i avsnitt 7. Hugs sett tur ut økta. Ikkje gjett bestilt etter ankomst berre fordi kallet manglar.
8. Cloudflare Worker (`cloudflare/signaltur-cron/`) startar logging på `main` kl. :07 og :37 UTC mellom 04 og 21. Ikkje 22:07 UTC. GitHub-cron med same minutt er reserve. Jobben skriv `signalturar.json` i sju dagar. `skipped` blir ikkje `booked`. `booked` krev faktisk avgang, ikkje berre eit ope kall etter fristen. `gått` er ein segla tomtur utan bestillingsbevis og blir ikkje «Ikkje utført». Turar som ikkje er i feeden blir ikkje logga. Eit hol blir fylt frå avlysing eller faktisk avgangstid, unntatt posisjonering før ein retur som sjølv har gått. Ein sein `updatedAt` varslar, men stoppar ikkje jobben.
9. Service worker som i avsnitt 9, med eige cachenamn på `/dev/`.
10. Sjekk med testane i avsnitt 11 før produksjon. Slepp via `dev`, ikkje med feature-PR mot `main`.
