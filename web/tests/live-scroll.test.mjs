// LIVE-knappen øvst rullar til «Nå»-kortet via den faste id-en, same mål uansett kva kortet seier.
import assert from "node:assert/strict";
import test from "node:test";
import { NOW_CARD_ID, scrollToNowCard } from "../src/model/header.js";

function fakeDoc(cardText) {
  const calls = [];
  const card = { text: cardText, scrollIntoView: (opts) => calls.push(opts) };
  return { calls, doc: { getElementById: (id) => (id === NOW_CARD_ID ? card : null) } };
}

for (const text of ["Ligg til kai på Standal", "På veg mot Trandal", "Ferja er utanfor ruta", "På veg til Valderøya · framme ca. 11:34"]) {
  test(`LIVE rullar til kortet med id ${NOW_CARD_ID}: «${text}»`, () => {
    const { calls, doc } = fakeDoc(text);
    assert.equal(scrollToNowCard(doc, { matchMedia: () => ({ matches: false }) }), true);
    assert.deepEqual(calls, [{ behavior: "smooth", block: "center" }]);
  });
}

test("LIVE: redusert rørsle rullar utan animasjon, og utan kort skjer ingenting", () => {
  const { calls, doc } = fakeDoc("Ligg til kai på Standal");
  scrollToNowCard(doc, { matchMedia: () => ({ matches: true }) });
  assert.deepEqual(calls, [{ behavior: "auto", block: "center" }]);
  assert.equal(scrollToNowCard({ getElementById: () => null }, null), false);
});

test("NowCard brukar den same faste id-en", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/components/NowCard.jsx", import.meta.url), "utf8");
  assert.match(src, /id=\{NOW_CARD_ID\}/);
});
