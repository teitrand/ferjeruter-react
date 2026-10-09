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
- Hendingar blir sletta etter 30 dagar, pulsar etter 2 dagar.
