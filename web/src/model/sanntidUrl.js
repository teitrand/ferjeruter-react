/** Adressa til AIS-workeren. Eigen fil utan importar: Vite-pluginen for tidleg henting (build/early-sanntid.js) les henne óg. */
export const SANNTID_URL = "https://fergeruter-sanntid.fergeruter-teitrand.workers.dev/v1/latest";

/** Adressa til workeren. VITE_SANNTID_URL overstyrer; «off» (eller tom) slår henting av AIS av. */
export function sanntidUrl(env = {}) {
  const value = env.VITE_SANNTID_URL;
  if (value === undefined) return SANNTID_URL;
  return value === "" || value === "off" ? null : value;
}
