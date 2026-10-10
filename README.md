# Fergeorakelet

Statisk oversikt over **trafikkmeldingar frå Fjord1** og **seglingsplanen** for Hjørundfjorden. Korleis kvar kjede blir henta, sjekka og sett saman, står i [docs/korleis-appen-verkar.md](docs/korleis-appen-verkar.md). Til vanleg viser sida rute **1136** Standal–Trandal–Sæbø–Skår–Valderøya–Store Kalvøy. Når Fjord1 innstiller 1136 (eller innfører kombirute), byter sida tabell automatisk.

Sida viser heile dagen som ei samanhengande tidslinje med alle anløpa i rekkjefølgje, og ei **No**-linje som fortel om ferja ligg til kai eller er på veg. Under dagen kan du velje **frå** og **til** (t.d. alle turar til Trandal, eller berre Standal→Trandal) og byte retning med pila mellom vala. Korrespondanse ligg i ei eiga nedtrekksliste. Posisjonen er i utgangspunktet rekna ut frå den aktive tabellen. Når Entur sender køyretøyposisjon for 1136 eller 1135, visest den som sanntid. Etter siste passasjertur på Valderøya eller Store Kalvøy reknar sida med at ferja går tilbake til Standal utan passasjerar (om lag to timar, deretter til kai) og ligg der over natta — den turen står ikkje i Entur. Mellom kaiene i Hjørundfjorden flyttar ho seg ikkje utan passasjerar.

Rutetabellane for 1136 og 1135 blir lasta ned frå Entur og lagra i `data/ruter.json`. Dei blir berre henta på nytt når innhaldet faktisk er endra. Kombinasjonsruta ligg ikkje i Entur; ho er transkribert frå FRAM-PDF til `data/kombirute.json`. Rutetabellen kjem frå lokale JSON-filer; nettlesaren kallar Entur berre for valfri køyretøyposisjon (CORS er open). Trafikkmeldingar kjem frå `data/trafikkmeldinger.json` når den kopien er fersk. Er ho eldre enn åtte minutt, hentar sida JSON frå vår eigen Cloudflare Worker (Fjord1 Ibexa, med CORS). `r.jina.ai` er berre siste utveg om workeren feilar.

## Kjelder

- Trafikkmeldingar: [fjord1.no/trafikkmeldingar](https://www.fjord1.no/trafikkmeldingar) via Fjord1 sitt Ibexa-view, servert med CORS frå Cloudflare-workeren i `cloudflare/trafikkmeldinger/`
- Rutetabell 1136 og 1135: [Entur Journey Planner](https://developer.entur.org/), lagra i `data/ruter.json` (`lines.1136` og `lines.1135`). Kai **Lekneset** blir normalisert til **Leknes**.
- Kombinasjonsrute: [FRAM-PDF frå 18.11.25](https://frammr.no/_f/p2/i2e02cdba-2cdc-4a23-b9bf-f6a6bd437bbe/kombinasjonsrute-sabo-leknes-skar-trandal-standal-20251118.pdf), transkribert til `data/kombirute.json` (ikkje Entur).
- Sanntidsposisjon: [Entur SIRI VM](https://developer.entur.no/open-data/realtime) (`datasetId=MOR`, `LineRef=MOR:Line:1136` og `1135`) når ferja rapporterer. Små ferjer kan vere utan køyretøy i straumen, særleg utanom rutetid. I kombimodus brukast sanntid berre om Kvernes rapporterer; elles melding + tidslinje.
- AIS-kart: [NAIS / Kystverket](https://nais.kystverket.no/) for M/F Kvernes (MMSI 257297400). BarentsWatch sitt AIS-API er gratis under NLOD, men krev innlogging med klient-id og hemmelegheit, så det passar ikkje på ei statisk GitHub Pages-side.
- Papir-ruteplan 1136: [Fjord1 rute 1136 (PDF)](https://www.fjord1.no/ruteoversikt/moere-og-romsdal/standal-trandal-valderoeya-store-kalvoey/(page)/pdf)
- Papir-ruteplan 1135: [Fjord1 rute 1135 (PDF)](https://www.fjord1.no/ruteoversikt/moere-og-romsdal/leknes-saeboe/(page)/pdf)

## Tre tabellar og ruteval

| Modus | Tabell | Når |
| --- | --- | --- |
| `1136` | Entur 1136 | Normal drift, eller «normal drift» sjølv om teksten òg seier innstilt |
| `1135` | Entur 1135 Sæbø–Leknes | 1136 er innstilt, og det er ikkje kombirute |
| `kombi` | `data/kombirute.json` | Teksten har `kombinasjon` / `kombirute` / `kombinert rute`, eller både 1135 og 1136 er innstilt |

Nyaste **gyldige lokale** Fjord1-melding styrer tabellen når 1136 er innstilt eller det er kombirute; då visest det same i **begge** sambanda. Ved normal drift vel du 1136 eller 1135 i sambandsvalet. Banneret viser framleis Fjord1-teksten, pluss ei merknad og lenke til FRAM-PDF-en når kombiruta er aktiv.

Korrespondansar: Solavågen og Hundeidvika via Festøya→Standal som før. Når aktiv tabell har **Leknes** (kombirute eller 1135), kjem òg buss **133 Leknes–Øye**.

Fjord1 sitt gamle GraphQL-endepunkt svarar 404, og Ibexa-viewet har ikkje CORS frå `teitrand.github.io`. Nettlesaren les derfor `data/trafikkmeldinger.json`, og når den er eldre enn åtte minutt spør han workeren `cloudflare/trafikkmeldinger/` (same Ibexa-kall som GitHub Actions, med CORS og 2 minutt kant-cache). Svarer ikkje workeren, blir HTML-sida lesen via `r.jina.ai` som siste utveg. GitHub Actions skriv framleis fila på `main`, men berre når meldingsteksten er endra. GitHub sin `*/5`-cron er reserve for den fila og blir ofte køyrd berre nokre gonger i døgnet. Workeren startar ikkje den jobben. Oppsett: `cloudflare/trafikkmeldinger/README.md`.

## Køyre lokalt

```bash
python3 scripts/fetch_trafikkmeldinger.py
python3 scripts/fetch_ruter.py
python3 -m http.server 8080
```

Opne [http://localhost:8080](http://localhost:8080). Under tittelen kan du byte **samband**: *Standal–Trandal* (1136) eller *Sæbø–Leknes* (1135). Valet blir hugsa i nettlesaren. Når Fjord1 køyrer kombirute (eller innstiller 1136), visest den tabellen i begge sambanda. På localhost (og `/dev/`) kan du òg tvinge tabell med `?rute=kombi`, `?rute=1135` eller `?rute=1136`.

## Språk

Sida er på **nynorsk**, **engelsk** og **tysk**. Ho byter automatisk til språket i nettlesaren (norsk, engelsk eller tysk); andre språk gjev engelsk. Trykk på eit flagg øvst til høgre for å overstyre; det valet blir hugsa i nettlesaren.

Stadnamn og trafikkmeldingane frå Fjord1 står på originalspråket.

## Installerbar app (PWA)

Sida kan installerast på telefonen frå nettlesaren. Knappen **Installer app** visest alltid i toppmenyen (ikkje når sida allereie køyrer som app). I Chrome og Edge kan han opne den innebygde installeringa. På iPhone/iPad og i andre nettlesarar som ikkje har den dialogen, opnar knappen ei rettleiing: Safari → **Del** → **Legg til på heimeskjerm**, Android → meny → **Installer app**. Då opnast ho som ei eiga app utan adressefelt, og rutetabellen verkar òg utan nett.

**Varslingar:** Appen kan **ikkje** sende eigne push-varsel enno. Det krev ein eigen tenar (GitHub Pages er berre statiske filer) og løyve frå brukaren. iOS støttar Web Push berre for appar som allereie ligg på heimeskjermen (16.4+). Innstillingar og avvik: bruk [SMS frå Fjord1](https://www.fjord1.no/kundeservice/foer-du-reiser/SMS-om-trafikken).

Rutetabellen (~400 KB) blir lagra i nettlesaren. Ved oppdatering av sida visest den lagra tabellen med ein gong; i bakgrunnen sjekkar sida om FRAM har gjeve ut ny rute. **Trafikkmeldingar** blir sjekka kvart 3. minutt (og når fana blir synleg). **Sanntidsposisjon** frå Entur blir henta om lag kvart minutt berre medan sida er synleg og det er rutetid.

**Google Play:** Ein PWA kan pakkast inn som Trusted Web Activity (t.d. med [PWABuilder](https://www.pwabuilder.com/) / Bubblewrap) og lastast opp til Play. Det er eige utgjevararbeid: Google Play-utviklarkonto, personvernerklæring, skjermbilete, innhaldsvurdering og Digital Asset Links på domenet. Sjølve koden her er klar for det; Play-butikken krev framleis den manuelle publiseringa.

## Produksjon og testhost

Produksjon er [teitrand.github.io/fergeruter](https://teitrand.github.io/fergeruter/) frå **`main`**. Testutgåva ligg på [teitrand.github.io/fergeruter/dev/](https://teitrand.github.io/fergeruter/dev/).

Pages kjem framleis frå `main` (legacy). Testhosten blir derfor kopiert inn som mappa `dev/` på `main` ved kvar push til greina `dev` (arbeidsflyta **Publiser testhost til /dev/**).

`github-pages`-miljøet tillèt berre `main`, så Actions-deploy frå `dev` feilar. Når de byter Pages til **GitHub Actions** (Settings → Pages → Source), kan `.github/workflows/pages.yml` køyrast frå `main` og publisere både rot og `/dev/` i same steg.

- **Alltid via `dev` før prod.** `dev` skal vere føre `main`. Feature-grein frå `dev` → PR mot `dev` → test på `/dev/` → først då merge `dev` → `main`. Ikkje opne feature-PR mot `main`.
- Service worker på `/dev/` har eige scope og eige cache-namn, så testinga ikkje stal cache frå prod
- Plausible tel ikkje på `/dev/` (same som localhost)
- Trafikkmelding-jobben som skriv JSON-fila køyrer berre på `main`. Testhosten `/dev/` les same `data/trafikkmeldinger.json` som produksjon. Når kopien er gammal, hentar både `/dev/` og produksjon frå Cloudflare-workeren, og frå `r.jina.ai` berre om workeren feilar.

## Oppdatering

- Trafikkmeldingar: Cloudflare-workeren `cloudflare/trafikkmeldinger/` svarar fersk JSON (Ibexa, cache 2 minutt, kortare om Fjord1 feilar). Nettlesaren les `data/trafikkmeldinger.json` kvart 3. minutt og spør workeren når `fetchedAt` er eldre enn 8 minutt. Fila på GitHub blir **ikkje** skriven om meldingane er dei same, så `fetchedAt` er ikkje eit hjarteslag. GitHub sin `*/5`-cron er reserve for fila og blir ofte ikkje køyrd. Workeren har ingen cron og startar ikkje workflowen. `r.jina.ai` blir brukt berre om workeren feilar. Oppsett: `cloudflare/trafikkmeldinger/README.md`.
- Signalturar: Cloudflare Worker (`cloudflare/signaltur-cron/`) startar logging på `main` kl. :07 og :37 UTC mellom 04 og 21. Ikkje 22:07 UTC, for det er 00:07 i Oslo i sommartid. Siste slag 21:37 UTC er 23:37 sommertid og 22:37 vintertid, og dekkjer siste signaltur 20:20 (framme 20:35) i båe. GitHub Actions skriv `data/signalturar.json` og fyller inn turar frå i dag som Entur enno har. Same cron på GitHub er reserve. Får jobben ingen runner, avbryt workeren ho etter 12 minutt og startar same køyring på nytt, så ho ikkje blir liggjande til GitHub merkjer ho som failure etter 15 minutt. Oppsett: `cloudflare/signaltur-cron/README.md`. For å stoppe: slå av cron på workeren og slå av workflowen **Logg signalturar**.
- Rutetabell 1136+1135 og korrespondansar (inkl. 133): last ned att **berre når tabellen er endra**. Nettlesaren viser sist lagra tabell med ein gong og oppdaterer i bakgrunnen:

```bash
python3 scripts/fetch_ruter.py
python3 scripts/fetch_korrespondanse.py
```

eller la GitHub Action **Oppdater rutetabell** gå. Ho køyrer kvar natt på `main` (`20 4 * * *` UTC) og kan òg startast manuelt. Fila blir berre skriven når tabellen er endra.

- Kombirute: når FRAM legg ut ny PDF, oppdater URL-en i `scripts/build_kombirute.py` og køyr:

```bash
python3 scripts/build_kombirute.py
```

Ikkje parse PDF automatisk i CI.

## Statistikk

Sida brukar [Plausible](https://plausible.io/) for å telje vitjingar og **kva folk faktisk trykkjer på**. Det er utan informasjonskapslar og utan personopplysningar. Lokal utvikling på `localhost` og testhosten `/dev/` blir ikkje telt.

Kvar vitjing (og kvar hending) får eigenskapane `lang` (`nn` / `en` / `de`), `app` (`web` / `pwa`) og `route` (`standal-trandal` / `saebo-leknes`). `route` er sambandsvalet som er lagra i nettlesaren (standard Standal–Trandal). I Plausible: **Filter → Property**, eller Site settings → **Custom properties** om `route` ikkje visest enno.

I Plausible-panelet ser du:

- Vitjingar, kjelder og utgåande lenkjer (t.d. Fjord1 og NAIS)
- Språk, samband og om sida er open i nettlesar eller som installert app (`lang`, `route` og `app`)
- Eigne hendingar for bruken av sida. Legg dei til som **mål (goals)** i Plausible (Site settings → Goals). Du kan òg la Plausible foreslå mål frå hendingar som allereie er sende inn.

| Hending | Når |
| --- | --- |
| `Visit nn` / `Visit en` / `Visit de` | Sidan lastar (anonymt, tel ikkje mot bounce) |
| `Visit pwa` | Sidan er open som installert app. I Plausible: filter **Property → app = pwa** for å sjå bruken av den installerte appen |
| `PWA first open` | Fyrste gong denne nettlesaren opnar den installerte appen (fangar òg iOS, der `appinstalled` ikkje finst). Beste talet på installasjonar saman med `App installed` |
| `Language nn` / `en` / `de` | Nokon byter språk |
| `Day prev` / `Day next` / `Day today` | Blad i rutetabellen |
| `From all` / `From Standal` / … | Filter på frå-stad |
| `To all` / `To Trandal` / … | Filter på til-stad |
| `Swap direction` | Byte frå og til |
| `Connection none` / `solavagen` / `hundeidvika` | Korrespondanse |
| `Route 1136` / `Route 1135` | Byte fergestrekning (klikk). Sjå òg `route` på alle vitjingar |
| `Messages local` / `route` | Filter på trafikkmeldingar |
| `Show past` / `Hide past` | Vis eller skjul tidlegare anløp |
| `Departure detail` | Trykk på ein avgang for å sjå detaljar (`signal`: `yes` / `no`) |
| `Install app` / `App installed` | Installer-knappen (`how`: `native` eller `help`), og når Chrome/Edge faktisk har lagt til appen |
| `Feedback yes` / `Feedback no` | Tommel opp/ned i tilbakemeldingsruta |
| `Feedback message` | Nokon sender ei skriftleg melding |

Sjølve meldingsteksten blir **ikkje** send til Plausible.

## Tilbakemelding

Nedst på sida ligg **Gje tilbakemelding**. Brukarane kan svare ja/nei (anonymt) og eventuelt skrive ei melding som opnar e-post til vedlikehaldaren, eller opne eit GitHub-issue.

## Testar

```bash
python3 -m unittest discover -s tests -v
node --test --test-concurrency=1 tests/test_status.mjs tests/test_i18n.mjs tests/test_plausible.mjs tests/test_route_mode.mjs tests/test_sw.mjs tests/test_signaltur_cron.mjs
```
