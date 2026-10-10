# Visuell sjekk (breidder, tema, tekststorleik)

Appen er laga for folk flest, så rutinekontrollen følgjer dei vanlegaste skjermane, ikkje ytterkantane.

**Éin kjelde:** `web/scripts/visual-config.mjs` (testa i `web/tests/visual-config.test.mjs`). Same lista brukar `web/scripts/visual-sweep.mjs`.

| Gruppe | Breidd × høgd (CSS-px) |
| --- | --- |
| Telefon | **360**×780, **390**×844, **412**×915, **430**×932, **440**×956 |
| Foldbar open | 720×840 (stå), 840×720 (låg). Lukka foldbar ≈ 360. |
| Nettbrett stå | **768**×1024, 820×1180, 1024×1366 |
| Nettbrett liggjande | 1024×768, 1180×820 |

Feit skrift = full sveip (alle seks «Nå»-tilstandar). Dei andre får «på veg» og «ukjend» pluss sida, ark og dialogar.

Kvar breidd blir køyrd **lyst og mørkt** (`prefers-color-scheme`) og med **normal og 130 % tekst** (`html { font-size: 130% }`, som «større tekst» i Android/iOS).

**320 px / 200 % er ikkje rutine.** Berre røyktest (`--sanity`): «fell ikkje appen frå kvarandre» (ingen borte tekst, ingen overlapping). Funn der er informasjon, ikkje krav; ikkje bruk tid på finpuss. (Kjend: tidslinja og meldingskorta blir litt breiare enn 320 px ved 200 % tekst.)

## Køyr

```sh
npm ci && npm run build:web
npm run preview -w web -- --port 4173 &
# playwright-core og ein Chromium er ikkje avhengnader i repoet:
PLAYWRIGHT_CORE=/sti/playwright-core/index.mjs CHROME=/sti/chrome \
  node web/scripts/visual-sweep.mjs --base http://localhost:4173/ --out /tmp/sveip   # alt (~10 min)
  # --width 360,768   berre desse breiddene     --quick   berre «på veg» og «ukjend»     --sanity   320 px/200 % røyktest
```

Utdata: `<breidd>-<tema>-<tekst>-<tilstand>.png` og `rapport.json`; exit 1 viss ein sjekk feilar.

## Kva sjekkane tek

Automatisk, per kombinasjon: sida breiare enn skjermen, element som stikk ut, klipt tekst, dialog/ark/meldingspanel/språkflagg og temaknapp som ikkje får plass, «Nå»-kortet dekt av det faste sambandskortet, og at botnteksten («Om dataa», fotnotar) kan nåast.

Sjå sjølv (bileta): 

- **«Nå»-kortet**, alle tilstandar: ved kai dag og natt, på veg, utanfor ruta, ukjend, berekna. Ferja og linja skal vere lesbare, ikkje små eller strekte.
- **Tidslinje**, signalturar, avlyst (raud), forseinka (oransje).
- **Samband-kortet** (fast nederst) og **arket**: kortet dekker aldri «Nå»-kortet; arket er maks 40rem og midtstilt.
- **Meldingspanel**, **botn**, **dialogar** (avgangsdetalj, tilbakemelding), **språkrada** og **temarada**.
- **Nettbrett:** éi lesekolonne (40rem) med topp, innhald og botn like breie, midt på skjermen; grunnskrifta er 112,5 % frå 700 px, og ferja veks til opptil 120 px.
