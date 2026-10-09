/**
 * Delt logikk for Fergeruter. Rein ESM utan avhengnader og utan byggjesteg,
 * så nettlesaren og testane importerer han direkte. Kvar import har ?v= med
 * versjonen i sw.js, så nettlesaren aldri blandar ny og gammal kode. Tekstane kjem
 * frå assets/i18n.js med same ?v= som app.js, så det blir berre éin i18n-modul.
 */
export * from "./time.js?v=84";
export * from "./legs.js?v=84";
export * from "./live.js?v=84";
export * from "./messages.js?v=84";
export * from "./timetable.js?v=84";
export * from "./plan.js?v=84";
export * from "./signal.js?v=84";
export * from "./tripstatus.js?v=84";
export * from "./status.js?v=84";
export * from "./entur.js?v=84";
export * from "./vessel.js?v=84";
export * from "./timeline.js?v=84";
export * from "./detail.js?v=84";
export * from "./prefs.js?v=84";
export * from "./chrome.js?v=84";
export * from "./track.js?v=84";
export * from "./crossing.js?v=84";
export * from "./nowinfo.js?v=84";
