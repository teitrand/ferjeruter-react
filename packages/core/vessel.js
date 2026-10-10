/**
 * Kva ferje som køyrer, og kva nummer ein ringjer for signaltur. `ctx` er same
 * plankontekst som plan.js (rutetabell, kombirute, meldingar, dato, klokke).
 */
import { defaultVesselName, messageVessel } from "./live.js?v=84";
import { messageMode, resolveRoutePlan } from "./messages.js?v=84";
import { activeMode } from "./plan.js?v=84";

export const DEFAULT_VESSELS = [
  { name: "M/F Geiranger", phone: "916 69 321" },
  { name: "M/F Kvernes", phone: "916 69 340" },
];

/** Ferja som køyrer denne tabellen denne dagen, ikkje ei utgått kombirute-melding. */
export function vesselNameForTable(table, ctx, date = ctx.date) {
  const plan = resolveRoutePlan(ctx.messages, ctx.nowMs ?? Date.now(), date);
  const fromMsg = messageVessel(plan.message);
  const after = plan.switch?.after || plan.mode;
  const before = plan.switch?.before;
  if (fromMsg) {
    if (plan.switch) {
      if (table === after) return fromMsg;
      if (table === before) return defaultVesselName(before);
    } else if (messageMode(plan.message) === table || plan.mode === table) {
      return fromMsg;
    }
  }
  return defaultVesselName(table);
}

export function vesselInfo(name, ctx) {
  const vessels = ctx?.kombirute?.vessels || DEFAULT_VESSELS;
  if (!name) return null;
  return (
    vessels.find((item) => item.name.toLowerCase().includes(name.toLowerCase())) || {
      name: `M/F ${name}`,
      phone: null,
    }
  );
}

/** Telefon til ferja som faktisk køyrer turen, elles nummeret frå rutetabellen. */
export function signalPhone(leg, ctx) {
  const table = leg?.table || activeMode(ctx);
  const running = vesselInfo(vesselNameForTable(table, ctx), ctx);
  if (running?.phone) return running.phone;
  if (leg?.signal?.phone) return leg.signal.phone;
  if (table === "1135") return vesselInfo("Geiranger", ctx)?.phone || "916 69 321";
  if (table === "kombi" || table === "1049" || table === "1069") return "";
  return vesselInfo("Kvernes", ctx)?.phone || "916 69 340";
}
