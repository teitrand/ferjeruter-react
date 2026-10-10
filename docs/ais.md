# AIS som posisjonskjelde (plan)

Status: **plan, ikkje bygd.** Dette dokumentet seier korleis innsamlaren (`collector/`, PR #3) skal få
AIS-posisjonar for dei to ferjene, kva Tor Eirik må gjere for å få tilgang, og korleis `collector/src/ais.js`
skal byggjast. Ingen nøklar, klient-ID-ar eller tokens høyrer heime i repoet, i chat eller i loggen.

| Ferje | MMSI | Linje |
| --- | --- | --- |
| M/F Kvernes | 257297400 | 1136 |
| M/F Geiranger | 257262400 | 1135 |
| M/F Dryna (verifisert 10. okt. 2026) | 258408000 | 1049 |
| M/F Festøya (verifisert) | 257090560 | 1069 |
| M/F Solavågen (verifisert) | 257090550 | 1069 |
| M/F Tidefjord (verifisert) | 258220500 | 1069 |

**1069 Festøya–Solavågen:** dei tre ferjene går om kvarandre med overlappande turar. Workeren lagrar éin AIS-rad per fartøy og gjev
alle i `lines["1069"].aisAll` (éin visning per fartøy, eldste fyrst); `ais` er som før den nyaste. Appen les `aisAll` (og `ais` frå ein
gammal worker) og tek alle fartøy med. Kva ferje som høyrer til kva tur, avgjer core `fixBelongsTo`: tid rundt rutetida, på strekninga,
og for AIS utan tur-id òg kurs (`headingTowards`: kurs mot startkaien er motsett tur) og kai (ei ferje som står stille ved endekaia før
turen har rekt fram, ventar på neste avgang derifrå). Ei ferje langt unna gjer ikkje ein tur til «utanfor ruta» når ei anna ferje har turen.
Framleis ikkje bygd: «No»-kort og status for 1069 (fleire ferjer samtidig; sjå `isMultiFerryRoute`).

## Kjelder vi har sett på (9. okt. 2026)

| Kjelde | Tilgang | Resultat frå serveren `ferjeappen` |
| --- | --- | --- |
| Kystverket sin opne rå-straum, TCP `153.44.253.27:5631` (NMEA/IEC 62320-1) | Open, utan registrering, NLOD (kystverket.no: «Tilgang på AIS-data») | Ustabil. 18:26: `Connection refused`. 18:39: tilkopla, men **0 byte på 120 s**. 18:42 frå PC-en heime: tidsavbrot. Ikkje brukande som hovudkjelde. |
| BarentsWatch Live AIS API, `live.ais.barentswatch.no` | Gratis brukar på barentswatch.no og ein eigen API-klient (scope `ais`) | Svarar `401 Bearer` utan token, som venta. Same opne AIS-data frå Kystverket, med filter på MMSI. **Vald.** |
| Kystverket, lukka del (alle AIS-data) | Søknad til post@kystverket.no (eller ais@kystverket.no) med føremål | Ikkje nødvendig: ferjene er med i dei opne dataa. |

Dei opne dataa dekkjer norsk økonomisk sone. Unntaka gjeld fiskefartøy under 15 m og fritidsfartøy under 45 m,
ikkje ferjer. Bruk krev kreditering: «AIS-data frå Kystverket (NLOD)» skal stå i appen.

## Det Tor Eirik må gjere (éin gong)

1. **Brukar:** lag ein brukar på https://www.barentswatch.no og logg inn på https://www.barentswatch.no/minside/.
2. **API-klient:** på Min side, under «API-tilgang (for utviklere)», vel «Ny klient».
   - Namn: `fergeruter-innsamlar`.
   - Vel eit langt, tilfeldig passord (client secret) og lagra det i passordhandsamaren.
   - Klient-ID-en blir `<e-posten din>:fergeruter-innsamlar`.
3. **Legg verdiane på serveren, ingen annan stad.** Logg inn på `ferjeappen` og køyr:

   ```bash
   sudoedit /etc/fergeruter/collector.env
   ```

   Legg til (fila er `root:fergeruter 0640`, og innsamlaren les ho ved start):

   ```ini
   # BarentsWatch Live AIS (scope ais). Hemmeleg: aldri i repo, chat eller logg.
   FERGERUTER_AIS_ENABLED=0
   FERGERUTER_AIS_CLIENT_ID=<e-posten din>:fergeruter-innsamlar
   FERGERUTER_AIS_CLIENT_SECRET=<passordet frå steg 2>
   ```

   La `FERGERUTER_AIS_ENABLED=0` stå til `ais.js` er godkjend og deploya.
4. **Test at klienten verkar utan å vise tokenet.** Kommandoen skriv berre type, levetid og scope:

   ```bash
   sudo python3 - <<'PY'
   import json, urllib.parse, urllib.request
   env = dict(l.strip().split("=", 1) for l in open("/etc/fergeruter/collector.env") if l.strip() and not l.startswith("#") and "=" in l)
   body = urllib.parse.urlencode({"client_id": env["FERGERUTER_AIS_CLIENT_ID"], "client_secret": env["FERGERUTER_AIS_CLIENT_SECRET"],
                                  "scope": "ais", "grant_type": "client_credentials"}).encode()
   try:
       d = json.load(urllib.request.urlopen("https://id.barentswatch.no/connect/token", body, timeout=15))
       print("OK", d.get("token_type"), d.get("expires_in"), d.get("scope"))
   except urllib.error.HTTPError as e:
       print("FEIL", e.code, e.read()[:200])
   PY
   ```

   Venta svar: `OK Bearer 3600 ais`.

Om passordet lek: slett klienten på Min side, lag ein ny og byt verdiane i `collector.env`.

## API-et vi skal bruke

- **Token:** `POST https://id.barentswatch.no/connect/token` med form-felta `grant_type=client_credentials`,
  `client_id`, `client_secret` og `scope=ais` i body (ikkje i headerar). Tokenet gjeld 3600 s.
- **Straum:** `POST https://live.ais.barentswatch.no/v1/sse/combined` (Server-Sent Events) med
  `Authorization: Bearer <token>`, `Accept: text/event-stream`, `Content-Type: application/json` og denne bodyen:

  ```json
  { "mmsi": [257297400, 257262400], "modelType": "Full", "downsample": false }
  ```

  Kvar hending er éin JSON-post: `mmsi`, `msgtime`, `latitude`, `longitude`, `speedOverGround`,
  `courseOverGround`, `trueHeading`, `navigationalStatus`, `name` osb. Same straum utan SSE finst på
  `/v1/combined` (JSON-liner). Spesifikasjonen ligg på
  `https://live.ais.barentswatch.no/live/openapi/ais/openapi.json`.
- **Siste kjende ved start:** `POST https://live.ais.barentswatch.no/v1/latest/combined` med
  `{ "mmsi": [...] }`. Éitt kall ved oppstart og etter eit brot fyller hòlet før straumen er i gang.

## Design for `collector/src/ais.js`

Same mønster som `stream.js` (graphql-ws mot Entur): rein logikk med innsprøytt klokke, timarar og `fetch`,
så alt kan testast utan nett.

- **Oppsett:** les `FERGERUTER_AIS_ENABLED`, `FERGERUTER_AIS_CLIENT_ID` og `FERGERUTER_AIS_CLIENT_SECRET`, og
  `FERGERUTER_AIS_MMSI` (standard `257297400:1136,257262400:1135`). Utan ID eller passord: AIS av, med éi
  logglinje utan verdiar.
- **Token:**
  - Haldt berre i minnet. Fornya når det er under 5 min att (om lag kvart 55. min) og éin gong ved `401`.
  - Tokenet blir aldri logga eller lagra.
  - Minst 60 s mellom token-kall ved feil, med backoff.
- **Tilkopling:**
  - Éin SSE-straum med MMSI-filteret over. Parsar `data:`-linjer og filtrerer MMSI på nytt lokalt.
  - Planlagd ny tilkopling med nytt token kvar 50. min, sidan vi ikkje veit om ein open straum overlever at
    tokenet går ut. Den tel ikkje som feil.
- **Backoff:** 15 s → 30 s → … → 15 min ved feil.
  - Nullstilt berre etter ei tilkopling som har levd minst 2 min (`HEALTHY_AFTER_MS`, som i `stream.js`).
  - Aldri meir enn 4 tilkoplingar i minuttet (same grensevakt).
  - `429` eller `5xx` gjev lengre ventetid, og `Retry-After` blir respektert.
- **Vakthund:** ingen hendingar på 10 min (heller ikkje SSE-kommentarar) gjev ny tilkopling.
  - Klasse A sender kvart 2.–10. s under fart og kvart 3. min ved kai, så 10 min stille betyr at straumen
    heng, ikkje at ferja er stille.
  - Om natta, når ferja ligg med straumen av, kan ho tie. Vakthunden aukar då berre backoff og bryt ikkje
    grensene.
- **Lagring:** i same `positions`-tabell med `source: 'ais'`, `vehicleId: 'mmsi:<mmsi>'` og linja frå MMSI-kartet.
  - Dupliskattar på `mmsi` + `msgtime`.
  - Fart, kurs, heading og `navigationalStatus` blir lagra.
- **Status:** `/status` får ein `ais`-del med `enabled`, `connected`, `connects`, `lastEventAt` per MMSI,
  `tokenValidUntil` (tid, ikkje token), `lastError` og `reconnectDelayMs`.
- **Testar** (falsk `fetch` og falsk klokke):
  - token-fornying før utløp og ved 401
  - SSE-parsing med delte chunkar
  - MMSI-filter
  - backoff og nullstilling
  - vakthund
  - at verken token eller passord finst i nokon logglinje

## Tersklar (frå SPEC, alt i `packages/core/crossing.js`)

| Tilstand | Under fart | Ved kai (fart < 0,5 kn innan kairadius) |
| --- | --- | --- |
| Live | ≤ 60 s | ≤ 4 min |
| Siste kjende | 60 s – 5 min | 4 – 15 min |
| Ukjent | > 5 min | > 15 min |

AIS går føre Entur sin posisjon når AIS-posisjonen er nyare. Entur blir verande reserve.

## Appen

- Innsamlaren eller workeren publiserer ein liten posisjonsfeed per linje: `latitude`, `longitude`,
  `speedOverGround`, `courseOverGround`, `msgtime` og `source: 'ais'`.
- Appen fyller `data.positions` frå denne feeden. `fixFromAis`, `bestFix` og merket «Live · AIS» finst
  alt i core.
- Det som manglar:
  - henting av feeden i web-modellen og i vanilla-appen
  - kreditering «AIS-data frå Kystverket (NLOD)»
  - testar
- Workeren og publiseringa krev godkjenning frå Tor Eirik før noko blir slått på.
