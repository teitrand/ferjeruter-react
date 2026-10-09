# Innsamlaren (heimeserveren)

`collector/` køyrer på heimeserveren `ferjeappen` som systemd-tenesta `fergeruter-collector`.
Han lyttar på sanntid frå Entur for 1136 og 1135, lagrar posisjonar og hendingar i SQLite
og skriv ein status-JSON med «det vi veit» per linje. Appen treng han ikkje: utan innsamlaren
(eller utan workeren) verkar appen akkurat som i dag.

## Kjelder og grenser

| Kjelde | Bruk | Grense |
|---|---|---|
| `wss://api.entur.io/realtime/v2/vehicles/subscriptions` (graphql-ws) | Hovudkjelde. Éi tilkopling, éin subscription per linje (`lineRef`), `bufferTime` 5 s, `bufferSize` 20. graphql-ws-`ping` kvart 25. s: Entur lukkar ei tilkopling utan trafikk etter om lag 60 s (kode 1006). | Ny tilkopling tidlegast 15 s etter førre, så dobling til 15 min. Maks 4 tilkoplingar per minutt (eigen grensevakt). |
| `https://api.entur.io/realtime/v1/rest/vm` (SIRI VM) | Reserve når straumen har vore nede i 2 min, og berre i driftstida for linja. | Kvar linje høgst éin gong per 60 s. Alle REST-kall: høgst 2 per 60 s og minst 30 s mellom (Entur: 4/min, 15 s; VM svara 429 på to kall med 20 s mellom 9. oktober). Backoff 1 → 15 min, og aldri før `Retry-After`. |
| `https://live.ais.barentswatch.no/v1/sse/combined` (BarentsWatch Live AIS, SSE) | **Av som standard** (`FERGERUTER_AIS_ENABLED`). AIS-posisjonar for MMSI 257297400 (Kvernes, 1136) og 257262400 (Geiranger, 1135), med token frå `id.barentswatch.no` (scope `ais`). Sjå `docs/ais.md`. | Éin straum. Ny tilkopling kvar 50. min med nytt token. Backoff 15 s → 15 min, maks 4 tilkoplingar per minutt, `Retry-After` blir respektert, token-feil gjev minst 60 s pause. Vakthund: 10 min utan data gjev ny tilkopling. |
| `teitrand.github.io/fergeruter/data/*.json` | Rutetabell, kombirute, meldingar, signallogg (ikkje Entur). | Kvar time. Siste gode kopi i `cache/`. |

Alle kall til Entur har `ET-Client-Name: teitrand-fergeruter-innsamlar` (`COLLECTOR_CLIENT` i `collector/src/client.js`), skilt frå `teitrand-fergeruter` som nettlesarane brukar.

### Grensevakta

`src/ratelimit.js` er eit glidande vindauge med tidsstempel. `guardedFetch` er den einaste
vegen til REST-endepunktet: når grensa er nådd, kastar han `RateLimitError` i staden for å kalle.
Grensene kan ikkje setjast over Entur sine (konstruktøren kastar). Testane køyrer tilfeldige
byger av kall i seks timar og to timar med REST-reserven på falsk klokke, og sjekkar kvart
60-sekunds vindauge og kvart mellomrom.

systemd startar tenesta på nytt etter 15 s (`RestartSec=15`), og REST-reserven startar fyrst
etter 2 min oppetid. Ein krasjløkke kan difor ikkje gje meir enn fire tilkoplingar i minuttet
og ingen REST-kall.

## Kva vi lagrar

`/var/lib/fergeruter/collector.sqlite` (WAL, `auto_vacuum=INCREMENTAL`):

- `positions`: linje, tid, kjelde (`stream`/`rest`/`ais`), fartøy, tur (`journey_ref`), posisjon, ved kai, kai (innanfor 250 m av ei kjend kai), mål, forseinking, `vehicle_status`, `valid_until`, og for AIS fart (`speed_kn`), kurs, heading og navigasjonsstatus (fartøy `mmsi:<mmsi>`). Same fartøy og same `recordedAt` blir lagra éin gong. AIS-posisjonane går ikkje gjennom hendingslogikken; hendingane kjem framleis berre frå Entur.
- `events`: `departed` (forlét kai), `arrived` (kom til kai), `sailed` (`liveProvesSailed` i core seier at turen i rutetabellen er køyrd), `cancelled` (Entur melder `CANCELLED`). Unike per dag, linje, slag, tur og kai.
- `meta`: siste kjende posisjon per linje, så han overlever omstart.

Rader eldre enn 30 dagar blir sletta kvar time (`FERGERUTER_RETENTION_DAYS`).

## Det vi veit: siste kjende og stale

Status blir skriven atomisk til `/var/lib/fergeruter/status.json` kvart 30. sekund og finst på
`http://127.0.0.1:8787/status` (berre lokalt). `/healthz` svarar `ok`, `degraded` eller `down`
(503 berre ved `down`).

```json
{
  "schema": 1,
  "generatedAt": "2026-10-09T09:21:31.597Z",
  "health": "ok",
  "source": "stream",
  "lines": {
    "1136": {
      "stale": true,
      "staleReason": "expired",
      "observedAt": "2026-10-09T08:50:12.000Z",
      "recordedAt": "2026-10-09T08:50:10Z",
      "validUntil": "2026-10-09T08:52:10Z",
      "ageSeconds": 1879,
      "lastKnown": { "stopName": "Trandal", "atStop": true, "journeyRef": "MOR:ServiceJourney:…", "…": "…" }
    }
  },
  "today": { "date": "2026-10-09", "lines": { "1136": { "sailed": [], "cancelled": [], "departures": [] } } },
  "stream": { "connected": true, "connects": 1, "…": "…" },
  "rest": { "active": false, "requestsLast60s": 0, "…": "…" },
  "db": { "positions": 0, "events": 0, "retentionDays": 30 },
  "sender": { "enabled": false }
}
```

- `stale` følgjer `isLiveFresh` i core: fersk til `validUntil`, elles 3 min etter `recordedAt`.
- `staleReason`: `null` (fersk), `no-data` (kjelda er oppe, men vi har aldri sett linja), `expired` (kjelda er oppe, men ferja har ikkje meldt seg; vanleg ved kai og om natta), `source-down` (verken straum eller REST er oppe).
- `lastKnown` blir alltid med når vi har noko, med tidspunkt. Han er aldri bevis for at ein tur gjekk når han er stale. Det er berre hendingane i `today` (med eiga tid).
- `health`: `ok` når ei kjelde er oppe, `degraded` når vi berre har gamle data, `down` når vi ikkje har noko.

Appen (steg 8) skal bruke dette slik: fersk → som sanntid; stale med `lastKnown` → «Sist sett HH:MM ved …» eller «Ukjent»; ingen svar, feil eller tidsavbrot → nøyaktig som i dag (eigne Entur-kall, rutetabell, det appen sjølv har sett).

## Avsendar til workeren (av)

`src/sender.js` er ferdig, men av: han sender berre når `FERGERUTER_SENDER_ENABLED=1`
og både `FERGERUTER_SENDER_URL` og `FERGERUTER_SENDER_KEY` er sette. URL og nøkkel kjem aldri
i status eller logg. Endepunktet er beskrive i [innsamlar-worker-endepunkt.md](innsamlar-worker-endepunkt.md)
og er ikkje laga.

## Nattleg samanlikning

`fergeruter-compare.timer` køyrer `npm run compare` (i går) kl. 03:20 Oslo-tid og skriv
`/var/lib/fergeruter/reports/samanlikning-<dato>.{json,md}`. For kvar tur:

- **App**: `tripStatus` slik appen viser dagen etterpå (berre signalloggen).
- **Innsamlar**: `sailed`/`cancelled` frå hendingane, og `tripStatus` med dei som bevis.
- **Logg**: status i `signalturar.json`.

Berre signalturar kan vere usamde. Faste turar er «Gått» i appen uansett. Dagar utan
posisjonar blir ikkje samanlikna. Manuelt: `cd /opt/fergeruter/app && sudo -u fergeruter env $(cat /etc/fergeruter/collector.env | grep -v '^#' | xargs) npm run compare -- --date 2026-10-09`.

## Drift

```bash
systemctl status fergeruter-collector
journalctl -u fergeruter-collector -f          # éi JSON-linje per hending, «puls» kvart 10. min
curl -s localhost:8787/status | jq '.health, .lines'
sqlite3 /var/lib/fergeruter/collector.sqlite 'select line, count(*), max(datetime(observed_at/1000,"unixepoch")) from positions group by line'
systemctl list-timers fergeruter-compare.timer
```

Installering og oppdatering (som root): `collector/deploy/install-node.sh` (Node 24 LTS frå
NodeSource sitt signerte apt-arkiv, med unattended-upgrades) og `collector/deploy/install.sh <ref>`
(git-utsjekk i `/opt/fergeruter/app`, `npm ci --omit=dev -w collector`, einingar, omstart).

Herding i einingane: eigen brukar `fergeruter`, ingen capabilities, `ProtectSystem=strict`
(berre `/var/lib/fergeruter` skrivbar), `ProtectHome`, `PrivateTmp`, `PrivateDevices`,
`PrivateUsers`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `SystemCallFilter=@system-service`
utan `@privileged @resources`, `MemoryMax=300M`, `TasksMax=64`. `MemoryDenyWriteExecute` står av
fordi V8 treng JIT.
