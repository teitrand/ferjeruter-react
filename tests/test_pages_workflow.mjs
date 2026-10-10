import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const yml = readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

test("Pages-bygget: rutedata frå eige repo og frisk frå Entur (feil stoppar ikkje byggjet); meldingar og signallogg frå produksjon", () => {
  // Tom VITE_DATA_BASE = vite legg kopien i dist/data/. Ein sett verdi (òg «./data/») gjev ingen kopi og 404 i førehandsvisinga.
  assert.match(yml, /VITE_DATA_BASE: \$\{\{ vars\.DATA_BASE \}\}\s*\n/, "rutetabellen følgjer med i byggjet");
  assert.doesNotMatch(yml, /VITE_DATA_BASE: \$\{\{ vars\.DATA_BASE \|\|/, "ingen standardverdi som slår av kopien");
  assert.match(yml, /VITE_LIVE_DATA_BASE: \$\{\{ vars\.LIVE_DATA_BASE \|\| 'https:\/\/teitrand\.github\.io\/fergeruter\/data\/' \}\}/);
  for (const script of ["fetch_ruter.py", "fetch_korrespondanse.py"]) {
    const at = yml.indexOf(`run: python scripts/${script}`);
    assert.ok(at > 0, script);
    assert.match(yml.slice(Math.max(0, at - 120), at), /continue-on-error: true/, `${script}: feil gjev kopien i repoet`);
    assert.ok(at < yml.indexOf("npm run build:web"), `${script} køyrer før byggjet`);
  }
  assert.match(yml, /schedule:\s*\n\s*- cron: "\d+ \*\/6 \* \* \*"/, "ombygging kvar 6. time");
  assert.doesNotMatch(yml, /git (push|commit)|commit_on_main/, "ingen commit frå workflowen");
});

test("data/ruter.json i repoet har alle samband appen kan velje (1049 inkludert)", () => {
  const routes = JSON.parse(readFileSync(new URL("../data/ruter.json", import.meta.url), "utf8"));
  for (const line of ["1136", "1135", "1049"]) assert.ok(routes.lines[line]?.legs?.length > 10, line);
});
