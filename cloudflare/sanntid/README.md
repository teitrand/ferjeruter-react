# Sanntid frå innsamlaren

Cloudflare Worker (`fergeruter-sanntid`) som tek imot hendingar og puls frå innsamlaren på heimeserveren og svarar appen med siste kjende posisjon og dagens hendingar. Design og stale-reglar: `docs/innsamlar-worker-endepunkt.md`.

Han er eigen worker, så `fergeruter-trafikkmeldinger` og `fergeruter-signaltur-cron` ikkje blir rørte. Lagring i D1 (`fergeruter-sanntid`, binding `DB`). Workeren spør aldri Entur.

## Endepunkt

- `POST /v1/events` og `POST /v1/heartbeat`: header `X-Fergeruter-Key`. Feil nøkkel gjev 401. Samanlikna i konstant tid.
  - Hendingar: høgst 50 og 64 KB per kall, idempotent på `serviceDate|line|kind|journeyRef|stop|slot`.
  - 429 med `Retry-After` om hendingar kjem oftare enn kvart 10. s, eller puls oftare enn kvart 30. s.
- `POST /v1/positions`: header `X-Fergeruter-Key`. Siste AIS-melding per fartøy (høgst 10 per kall, 429 oftare enn kvart 10. s). Lagra i `ais_latest`.
- `POST /v1/signalturar`: header `X-Fergeruter-Key`. Signalloggen frå heimeserveren (høgst 64 KB, 429 oftare enn kvart minutt, 409 om ein eldre logg). `GET /v1/signalturar` er offentleg (CORS `*`, `no-cache`, 404 før noko er skrive). Sjå `docs/signaltur-heimeserver.md`.
- `GET /v1/latest`: offentleg, CORS `*`, `Cache-Control: public, max-age=15`. Per linje: `ais` (nyaste fartøy) og `aisAll` (éin visning per fartøy, eldste fyrst; 1069 har tre ferjer).

Hendingar blir sletta etter 30 dagar, pulsar etter 2 dagar (ved kvar puls).

URL: `https://fergeruter-sanntid.fergeruter-teitrand.workers.dev/`

## Oppsett

Tabellane (òg `ais_latest`, lagd til seinare; `CREATE TABLE IF NOT EXISTS`) står i `SCHEMA` i `src/index.js` og er oppretta i D1 éin gong. Endringar etter det ligg som migreringar i `migrations/` (wrangler sin standardmappe). Før workeren blir deploya: `npx wrangler d1 migrations list fergeruter-sanntid --remote` for å sjå kva som manglar, så `npx wrangler d1 migrations apply fergeruter-sanntid --remote`. Fyrste migrering, `0001_ais_destination.sql`, legg til kolonna `destination` (AIS-destinasjonen) i `ais_latest`. Nøkkelen:

```bash
npx wrangler secret put COLLECTOR_KEY   # same verdi som FERGERUTER_SENDER_KEY i /etc/fergeruter/collector.env
npx wrangler deploy
```

## Stopp

Set `FERGERUTER_SENDER_ENABLED=0` på serveren, eller slett workeren. Appen les `/v1/latest` og fell tilbake til Entur og rutetabell når workeren manglar.

## Entur VM (sanntid) via workeren

Appen spør ikkje Entur VM direkte lenger. Cron (`* * * * *`) hentar VM for 1136, 1135, 1049 og 1069 med `ET-Client-Name: teitrand-fergeruter`, to gonger per minutt (30 s mellomrom), og lagrar rå SIRI-JSON i `vm_latest` (migrering `0002_vm_latest.sql`). `GET /v1/vm?LineRef=MOR:Line:1136` les berre det lagra svaret (aldri Entur) og gjev `{ schema, line, fetchedAt, ageMs, Siri }`; 503 når ingenting er lagra. Appen har same backoff som før ved feil.
