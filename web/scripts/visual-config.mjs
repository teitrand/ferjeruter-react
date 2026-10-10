// Standard for visuelle kontrollar (headless): vanlege telefonar, foldbare og nettbrett (stå og liggjande), lyst og mørkt,
// normal og litt større tekst.
// 320 px/200 % er IKKJE ein rutinekrav; det er berre ein røyktest («fell ikkje frå kvarandre»), sjå SANITY.
// Brukt av scripts/visual-sweep.mjs og testa i tests/visual-config.test.mjs. Dokumentert i docs/visuell-sjekk.md.
// full: alle seks Nå-tilstandar; elles berre «på veg» og «ukjend» (dei to mest ulike). Alle får sida, ark og dialogar.
export const VIEWPORTS = [
  { width: 360, height: 780, label: "liten Android / foldbar lukka", full: true },
  { width: 390, height: 844, label: "iPhone", full: true },
  { width: 412, height: 915, label: "Pixel/Samsung", full: true },
  { width: 430, height: 932, label: "iPhone Pro Max", full: true },
  { width: 440, height: 956, label: "største telefonar (iPhone 16/17 Pro Max)", full: false },
  { width: 720, height: 840, label: "foldbar open (stå)", full: false },
  { width: 840, height: 720, label: "foldbar open (låg)", full: false },
  { width: 768, height: 1024, label: "nettbrett stå", full: true },
  { width: 820, height: 1180, label: "nettbrett stå (iPad Air)", full: false },
  { width: 1024, height: 768, label: "nettbrett liggjande", full: false },
  { width: 1180, height: 820, label: "nettbrett liggjande (iPad Air)", full: false },
  { width: 1024, height: 1366, label: "stort nettbrett stå", full: false },
];
export const THEMES = ["light", "dark"];
// html-skriftstorleik i prosent: normal og «litt større tekst» (typisk Android/iOS-innstilling).
export const TEXT_SCALES = [100, 130];
// Røyktest, ikkje rutine: éin køyring, ingen tid på finpuss. Berre «overflyt og tekst blir ikkje borte».
export const SANITY = { width: 320, height: 700, textScale: 200, theme: "light" };

export const ROUTINE_COMBINATIONS = VIEWPORTS.length * THEMES.length * TEXT_SCALES.length;
