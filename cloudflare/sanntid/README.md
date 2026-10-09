# Sanntid frå innsamlaren

Cloudflare Worker (`fergeruter-sanntid`) som tek imot hendingar og puls frå innsamlaren på heimeserveren og svarar appen med siste kjende posisjon og dagens hendingar. Design og stale-reglar: `docs/innsamlar-worker-endepunkt.md`.

Han er eigen worker, så `fergeruter-trafikkmeldinger` og `fergeruter-signaltur-cron` ikkje blir rørte. Lagring i D1 (`fergeruter-sanntid`, binding `DB`). Workeren spør aldri Entur.

## Endepunkt

- `POST /v1/events` og `POST /v1/heartbeat`: header `X-Fergeruter-Key`. Feil nøkkel gjev 401. Samanlikna i konstant tid.
  - Hendingar: høgst 50 og 64 KB per kall, idempotent på `serviceDate|line|kind|journeyRef|stop|slot`.
  - 429 med `Retry-After` om hendingar kjem oftare enn kvart 10. s, eller puls oftare enn kvart 30. s.
- `POST /v1/positions`: header `X-Fergeruter-Key`. Siste AIS-melding per fartøy (høgst 10 per kall, 429 oftare enn kvart 10. s). Lagra i `ais_latest`.
- `GET /v1/latest`: offentleg, CORS `*`, `Cache-Control: public, max-age=15`.

Hendingar blir sletta etter 30 dagar, pulsar etter 2 dagar (ved kvar puls).

URL: `https://fergeruter-sanntid.fergeruter-teitrand.workers.dev/`

## Oppsett

Tabellane (òg `ais_latest`, lagd til seinare; `CREATE TABLE IF NOT EXISTS`) står i `SCHEMA` i `src/index.js` og er oppretta i D1 éin gong. Nøkkelen:

```bash
npx wrangler secret put COLLECTOR_KEY   # same verdi som FERGERUTER_SENDER_KEY i /etc/fergeruter/collector.env
npx wrangler deploy
```

## Stopp

Set `FERGERUTER_SENDER_ENABLED=0` på serveren, eller slett workeren. Appen les `/v1/latest` og fell tilbake til Entur og rutetabell når workeren manglar.
