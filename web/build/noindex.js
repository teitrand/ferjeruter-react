// Søkjemotorar: berre bygg for rota av eige domene (WEB_BASE=/) kan indekserast.
// Førehandsvisinga på /ferjeruter-react/ og lokale bygg får «noindex».
export function noindexUnlessRoot(base) {
  return {
    name: "fergeruter-noindex",
    transformIndexHtml() {
      if (base === "/") return [];
      return [{ tag: "meta", attrs: { name: "robots", content: "noindex" }, injectTo: "head" }];
    },
  };
}
