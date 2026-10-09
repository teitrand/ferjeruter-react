# Avvik og grensetilfelle i posisjonsrekkja (AIS > Entur > rutetabell)

Kva appen, samlaren og workeren gjer når verkelegheita ikkje følgjer rutetabellen. Kjelder: `packages/core/crossing.js`
(`outsideFix`, `statusFromPosition`, `crossingView`), `collector/src/ais.js`, `cloudflare/sanntid/src/index.js`.
Prinsippet: vi viser det vi veit, med kjelde og tid, og finn ikkje opp tal.

| # | Tilfelle | Før | No | Att |
|---|----------|-----|----|-----|
| 1 | Ferja langt frå ruta (ambulansetur, omveg, verkstad, anna samband) | Posisjonen blei kasta som «ikkje denne turen», og «Nå» viste berekna framdrift frå rutetabellen og «på veg mot X» | AIS-posisjon > 4 km frå alle kaier (eller utanfor korridoren rundt turen) gjev state `outside`: merket «Utanfor ruta · AIS kl. hh:mm», overskrift «Ferja er utanfor ruta», ingen ferjelinje, prosent, neste tur eller ankomsttid. Held seg inntil 12 t, så fell vi attende til «Ukjent/berekna» | Ferd i sona 2,5–4 km frå ei kai, utanfor sjølve korridoren, blir ikkje flagga |
| 2 | Forseinking | AIS i fart ved ei kai medan tabellen sa «ligg til kai» blei retta til «på veg» (ved ≤ 10 min avvik). Entur gjev faktisk avgang og forseinking | Same. Meir enn 10 min avvik og AIS i fart: «Ferja er i fart, men vi finn ingen planlagd tur som passar», ikkje «ligg til kai/ferdig for dagen» | Forseinking i minutt frå AIS åleine (utan Entur) blir ikkje rekna ut |
| 3 | Ekstratur utan tabelltur | Status stod på «ligg til kai/ferdig for dagen» | Som over (`unscheduled`), berre ved fersk AIS med kjend fart ≥ 0,5 kn | Ingen eigen tur-visning |
| 4 | Ferja vekke i dagar, erstatningsferje med anna MMSI | MMSI→linje står i `FERGERUTER_AIS_MMSI` (samlaren) og blir ikkje endra utan omstart. Workeren lagrar ei rad per MMSI og viser det nyaste fartøyet per linje | Ferje utanfor ruta: som #1. Erstatning: sett `FERGERUTER_AIS_MMSI="<mmsi>:1136,…"` på tenaren og start samlaren på nytt; workeren tek den nyaste automatisk | Ingen overstyring frå workeren (sjå forslag) og ingen visning av at det er ei anna ferje |
| 5 | Gamal eller rar AIS | Worker avviser ugyldig lat/lon, `msgtime` i framtida, ikkje-tal; farten 102,3 og kurs 360 blir «ukjend» (null) i core; eldre melding skriv ikkje over nyare; for gamal blir «Ukjent» | Uendra, men null fart gjev aldri «ligg til kai» eller «i fart» | Éin urimeleg hopp-posisjon (gyldig lat/lon, langt unna) kan gje «Utanfor ruta» til neste melding. Ingen hoppfilter |

## Det som står att (ikkje bygd, med vilje)
- **Overstyring av fartøy frå workeren:** forslag, ein liten tabell `vessel_override(line, mmsi, valid_until, note)` skriven med `COLLECTOR_KEY`-nøkkelen og lesen av samlaren (`GET /v1/config`), slik at MMSI kan byttast utan SSH. Ingen automatikk, og ingen gjetting av erstatningsferja.
- **Hoppfilter** i samlaren: kast ein posisjon som tilseier > 50 kn frå førre godtekne, men godta ho etter tre like på rad.
- **Forseinking frå AIS:** eit anslag (avstand til kai / fart) hører heime i eit eige tiltak, og skal merkjast som anslag.
- **Visning av erstatningsferje:** namn frå AIS (`name` ligg alt i svaret frå workeren) kan visast i merket.
- **Sone 2,5–4 km:** ei finare avgrensing kan bruke korridoren rundt linja til alle turar.
