# Signaltur-sjekken på heimeserveren

Sjekken som seier om ein signaltur er **bestilt**, **gått** eller **ikkje utført** kjem ikkje frå appen, men frå ein jobb
som spør Entur og skriv ein logg. Appen les loggen. Står loggen stille i meir enn 70 minutt i vaktvindauget
(04:00–22:40 UTC), viser appen den gule åtvaringa «Sjekken av signalturar har ikkje køyrt sidan …».

## Slik går det

```
heimeserveren (systemd-timer, kvart 10. min)            GitHub Actions (reserve, kvar halvtime, i fergeruter)
  scripts/signaltur_server.py                              scripts/signaltur_loop.py → data/signalturar.json
    ↓ POST /v1/signalturar  (X-Fergeruter-Key)               ↓ commit til main → GitHub Pages
  sanntid-workeren (D1, tabellen meta)                     teitrand.github.io/fergeruter/data/signalturar.json
    ↓ GET /v1/signalturar (offentleg, CORS *)                ↓
                      appen: henta båe, nyaste `updatedAt` vinn
```

- **Sjekken** er `run_check` i `scripts/log_signalturar.py` (same logikk som GitHub-jobben bruker; `main()` kallar han).
  Han hentar avlysingar og faktiske avgangar frå Entur (Journey Planner og SIRI VM) og oppdaterer loggen for i dag.
  Opp til sju dagar blir tekne vare på.
- **Inndata:** `ruter.json` frå Pages (siste gode kopi i `/var/lib/fergeruter/signaltur/ruter.json` om Pages ikkje svarar) og førre logg: den
  nyaste av workeren og Pages (og lokal kopi). Slik går ingenting tapt om ein av jobbane står ei stund.
- **Utdata og «sist køyrt»:** loggen sjølv. `updatedAt` blir sett til tidspunktet sjekken køyrde, kvar gong, og er det
  appen måler alder på (`signalLogStale` i `packages/core/tripstatus.js`). Workeren legg til `receivedAt`.
- **Appen** (`web/src/hooks/useSignalLog.js`) hentar båe kjeldene ved oppstart, kvart 5. minutt (berre i synleg fane) og når sida
  vaknar. Er workeren nede eller manglar loggen (404), gjeld fila på Pages som før. Ingenting i appen krev workeren.

## Workeren (`fergeruter-sanntid`, tillegg, bakoverkompatibelt)

- `GET /v1/signalturar`: offentleg, CORS `*`, `Cache-Control: no-cache`. Same form som `signalturar.json` (`keptDays`, `updatedAt`, `days`) pluss `receivedAt`. 404 til jobben har skrive fyrste gong.
- `POST /v1/signalturar`: header `X-Fergeruter-Key` (same `COLLECTOR_KEY` som dei andre skriveendepunkta; feil nøkkel 401). Body `{ "schema": 1, "log": { … } }`, høgst 64 KB.
  Validerer `updatedAt` (ikkje meir enn 5 min fram i tid), `days` (dato → liste) og `keptDays`. Høgst eitt godteke kall per minutt (429 + `Retry-After`).
  Ein eldre logg enn den som ligg der gjev 409 og skriv ikkje over.
- Lagring i `meta` (nøkkel `signalturar`): ingen ny tabell og ingen endring i dei andre endepunkta.

## Eininga på serveren

`collector/systemd/fergeruter-signaltur.service` (oneshot, same herding som innsamlaren, brukar `fergeruter`) og `fergeruter-signaltur.timer` (`OnCalendar=*:0/10`, `Persistent=true`).
Miljø frå `/etc/fergeruter/collector.env`: `FERGERUTER_SENDER_KEY` (påkravd), `FERGERUTER_SENDER_URL` (valfri; workeren), `FERGERUTER_DATA_BASE` og `FERGERUTER_SIGNAL_STATE` (valfrie). Nøkkelen blir aldri skriven ut.
`collector/deploy/install.sh` installerer og slår på timeren.

```bash
systemctl list-timers fergeruter-signaltur.timer      # neste køyring
journalctl -u fergeruter-signaltur.service -n 20      # siste køyringar («Loggen er skriven …»)
sudo systemctl start fergeruter-signaltur.service     # køyr éin gong no
curl -s https://fergeruter-sanntid.fergeruter-teitrand.workers.dev/v1/signalturar | head -c 300
```

## Feil og reserve

| Det som stoppar | Kva skjer |
|---|---|
| Serveren eller timeren er nede | Loggen i workeren eldast. GitHub-jobben skriv framleis til Pages, og appen tek den nyaste. Gjer begge det, viser appen åtvaringa først etter 70 min som før. |
| Entur svarar ikkje | Jobben avsluttar med feil (systemd merkjer køyringa), ingen ny logg, neste runde prøver att. |
| Workeren avviser (401/5xx) | Køyringa feilar og går att. 409/429 er ikkje feil. |
| Pages manglar | Siste gode `ruter.json` frå cache. Utan cache stoppar køyringa. |

## Slå av GitHub-jobben seinare

Gjer det fyrst når serverjobben har køyrt stabilt (til dømes ei veke utan feilra køyring og utan åtvaring i appen). Då kan ein, i `fergeruter`-repoet (ikkje her):

1. Stogge `fergeruter-signaltur-cron` (Cloudflare-workeren som trigger workflowen), eller fjerne cron-linja i `log-signalturar.yml`.
2. La `data/signalturar.json` ligge: den er reserven appen les om workeren manglar. Ein kjapp køyring av workflowen held fila fersk ved behov.
3. Skal reserven bort heilt: fjern lesinga frå Pages i `signalLogUrls` (`web/src/model/signallog.js`) og i `fetchAppData`.
