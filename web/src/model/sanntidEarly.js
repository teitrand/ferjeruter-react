/**
 * Svaret frå den tidlege hentinga i index.html (build/early-sanntid.js). Kan berre brukast ein gong, og berre
 * for same adresse; elles (ingen tidleg henting, anna adresse, brukt opp) spør appen sjølv.
 * @returns {Promise<object>|null} JSON-svaret, eller eit avvist løfte når hentinga feila
 */
export function takeEarlySanntid(url, scope = globalThis) {
  const early = scope.__sanntidEarly;
  if (!early || early.used || early.url !== url) return null;
  early.used = true;
  return early.promise;
}
