import { sanntidUrl } from "../src/model/sanntidUrl.js";

// Startar /v1/latest frå <head>, før React-bunten er lasta, og koplar til workeren tidleg (preconnect).
// Appen tek svaret i bruk i staden for å spørje på nytt (src/model/sanntidEarly.js). Feil blir svelgde her;
// appen ser at svaret manglar og spør sjølv, med vanleg backoff.
export const EARLY_TIMEOUT_MS = 4000;

export function earlyScript(url) {
  return `(function(){try{var c=new AbortController();setTimeout(function(){c.abort()},${EARLY_TIMEOUT_MS});` +
    `var p=fetch(${JSON.stringify(url)},{credentials:"omit",signal:c.signal}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json()});` +
    `p.catch(function(){});window.__sanntidEarly={url:${JSON.stringify(url)},promise:p}}catch(e){}})();`;
}

export function earlySanntid(env) {
  return {
    name: "fergeruter-early-sanntid",
    transformIndexHtml() {
      const url = sanntidUrl(env);
      if (!url) return [];
      const origin = new URL(url).origin;
      return [
        { tag: "link", attrs: { rel: "preconnect", href: origin, crossorigin: "" }, injectTo: "head-prepend" },
        { tag: "script", children: earlyScript(url), injectTo: "head-prepend" },
      ];
    },
  };
}
