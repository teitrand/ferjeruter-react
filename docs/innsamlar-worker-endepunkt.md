# Endepunkt i workeren for innsamlaren

Laga i `cloudflare/sanntid/` og deploya som `fergeruter-sanntid` (sjå README der). Nøkkelen er Worker-løyndomen `COLLECTOR_KEY`. Avsendaren i innsamlaren sender hit.

## Prinsipp

- Appen må verke uendra utan workeren og utan innsamlaren. Alt her er tillegg.
- Workeren lagrar fakta med tid og seier sjølv kor gamle dei er. Han gjettar ikkje.
- Ein eigen worker (`fergeruter-sanntid`), så dei to som finst ikkje blir rørt.
- Lagring: D1 (SQLite). KV på gratisplanen tek berre 1000 skrivingar i døgnet; puls kvart 2. min åleine er 720.

## POST /v1/events (innsamlaren → workeren)

Header `X-Fergeruter-Key: <nøkkel>`. Nøkkelen er ein Worker-løyndom (`COLLECTOR_KEY`) og står i
`/etc/fergeruter/collector.env` på serveren. Samanlikna i konstant tid. Feil nøkkel: 401, ingenting lagra.

```json
{ "schema": 1, "events": [
  { "line": "1136", "kind": "sailed", "serviceDate": "2026-10-09", "at": "2026-10-09T09:06:00.000Z",
    "journeyRef": "MOR:ServiceJourney:1136_101_…", "stop": "Trandal",
    "detail": { "departure": "11:05:00", "from": "Trandal", "to": "Standal", "signal": true } }
] }
```

- `kind`: `sailed`, `departed`, `arrived`, `cancelled`. Høgst 50 hendingar og 64 KB per kall.
- Idempotent: nøkkelen `serviceDate|line|kind|journeyRef|stop|slot` gjev same rad ved nytt forsøk.
- Svar: `204`. `400` ved feil form, `413` for stort, `429` om innsamlaren sender oftare enn kvart 10. s.
- Innsamlaren prøver att med backoff 1 → 15 min og held høgst 500 hendingar i kø.

## POST /v1/heartbeat (innsamlaren → workeren, kvart 2. min)

Same header. Kropp: utdrag av status-JSON-en: `generatedAt`, `health`, `source`, og per linje
`lastKnown` (posisjon, kai, ved kai, tur, `recordedAt`, `validUntil`) og `observedAt`.
Workeren lagrar siste puls og når han kom (`receivedAt`, workeren si klokke).

## POST /v1/positions (innsamlaren → workeren, AIS)

Same header. AIS er sanninga for posisjon; Entur er neste nivå og rutetabellen reserve (sjå «Posisjonsrekkefølgje»).
Innsamlaren sender siste AIS-melding per fartøy, aldri ei kø:

```json
{ "schema": 1, "positions": [
  { "mmsi": "257297400", "line": "1136", "name": "KVERNES", "latitude": 62.2607, "longitude": 6.5005,
    "speedKn": 9.2, "courseDeg": 44.4, "heading": 22, "navStatus": 0,
    "msgtime": "2026-10-09T17:00:00.000Z", "source": "ais" } ] }
```

- Høgst 10 per kall. `204`, `400` (ugyldig, melding frå framtida, `source` ikkje `ais`), `401`, `413`, `429` med `Retry-After`.
- Éi rad per MMSI (`ais_latest`). Ei eldre melding skriv ikkje over ei nyare.
- Takt frå innsamlaren: under fart (eller flytta ≥ 30 m) minst 15 s mellom kall, ved kai minst 60 s; felles klokke på 15 s. Workeren tek imot eitt kall per 10 s.
- `Retry-After` frå workeren set eit golv for neste forsøk, så blir den nyaste meldinga sendt (ikkje ei kø).

`GET /v1/latest` får `lines[<linje>].ais` (tillegg, resten er uendra):

```json
"ais": { "source": "ais", "mmsi": "257297400", "name": "KVERNES", "latitude": 62.2607, "longitude": 6.5005,
         "speedKn": 9.2, "courseDeg": 44.4, "heading": 22, "navStatus": 0, "msgtime": "…", "receivedAt": "…",
         "moored": false, "ageMs": 5000, "state": "live", "stale": false, "staleReason": null }
```

`state` blir rekna ut ved spørsmål, frå `msgtime`: under fart `live` ≤ 60 s, `stale` (siste kjende) ≤ 5 min, så `unknown`;
ved kai (fortøydd eller under 0,5 kn) 4 min og 15 min. Tersklane er dei same som `packages/core/crossing.js` (testen held dei like).
Ei linje med berre AIS (ingen puls) får `lastKnown: null` og `stale` som før.

## Posisjonsrekkefølgje i appen

AIS > Entur > rutetabell. Appen vel posisjonen per ferskleik (live > siste kjende > ukjend), så kjelde (AIS framfor Entur),
så nyaste. Ein gamal AIS-posisjon slår altså ikkje ein fersk Entur-posisjon. Utan målt posisjon er framdrifta rekna ut frå
rutetabellen og vist som stipla «Berekna». AIS har ingen tur-ID og beviser difor ikkje at ein tur gjekk: statuslinja og
`sailed`/`cancelled` kjem framleis frå Entur og rutetabellen.

## GET /v1/latest (appen → workeren, offentleg)

CORS `*`, `Cache-Control: public, max-age=15`. Ingen nøkkel.

```json
{
  "schema": 1,
  "generatedAt": "2026-10-09T09:21:40Z",
  "collector": { "lastHeartbeatAt": "2026-10-09T09:20:30Z", "stale": false },
  "lines": {
    "1136": {
      "lastKnown": { "stopName": "Trandal", "atStop": true, "journeyRef": "MOR:ServiceJourney:…",
                     "latitude": 62.26, "longitude": 6.50, "recordedAt": "2026-10-09T08:50:10Z",
                     "validUntil": "2026-10-09T08:52:10Z" },
      "observedAt": "2026-10-09T08:50:12Z",
      "stale": true,
      "staleReason": "expired"
    }
  },
  "today": { "date": "2026-10-09", "lines": { "1136": { "sailed": ["MOR:ServiceJourney:…"], "cancelled": [], "departures": [] } } }
}
```

Stale blir rekna ut når nokon spør, ikkje når det vart lagra:

| Tilfelle | `collector.stale` | linje `stale` | `staleReason` |
|---|---|---|---|
| Fersk posisjon, puls under 5 min | false | false | `null` |
| Posisjonen er gammal, innsamlaren lever | false | true | `expired` / `no-data` |
| Innsamlaren har ikkje sendt puls på 5 min | true | true | `collector-down` |
| Ingenting lagra | true | true | `no-data` |

Appen (steg 8):

- `stale: false` → bruk `lastKnown` som sanntid (same form som `parseVehicleMonitoring`).
- `stale: true` med `lastKnown` → vis siste kjende med klokkeslett, eller «Ukjent». Ein gammal posisjon er aldri bevis for at ein tur gjekk eller ikkje gjekk.
- `today.lines.*.sailed` og `cancelled` er hendingar med eiga tid og gjeld heile dagen, som det appen hugsar sjølv. Dei kan brukast sjølv når posisjonen er stale.
- 404, 5xx, CORS-feil eller meir enn 4 s → appen gjer som i dag: eigne Entur-kall, rutetabell og det han sjølv har sett. Ingen feilmelding til brukaren berre fordi workeren manglar.

## Avgrensingar

- Ingen persondata: berre ferje, posisjon, tur og kai.
- Workeren spør aldri Entur. Han får data berre frå innsamlaren.
- Hendingar blir sletta etter 30 dagar, pulsar etter 2 dagar. `ais_latest` har éi rad per fartøy.
