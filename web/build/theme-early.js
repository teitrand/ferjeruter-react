import { DARK_QUERY, THEME_COLORS, THEME_KEY } from "../src/model/theme.js";

// Set temaet i <head>, før fyrste teikning (ingen blink). Same regel som resolveTheme/applyTheme i src/model/theme.js;
// tests/theme.test.mjs køyrer dette skriptet i ei sandkasse og samanliknar med modellen.
export function themeScript() {
  return (
    `(function(){try{var d=document,r=d.documentElement,p="system";` +
    `try{var v=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(v==="light"||v==="dark")p=v}catch(e){}` +
    `var t=p;if(p==="system"){t=window.matchMedia&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light"}` +
    `r.setAttribute("data-theme",t);r.setAttribute("data-theme-pref",p);r.style.colorScheme=t;` +
    `var c=d.querySelector('meta[name="theme-color"]');if(c)c.setAttribute("content",t==="dark"?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)});` +
    `var s=d.querySelector('meta[name="color-scheme"]');if(s)s.setAttribute("content",p==="system"?"light dark":t)}catch(e){}})();`
  );
}

export function themeEarly() {
  return {
    name: "fergeruter-theme-early",
    transformIndexHtml() {
      return [{ tag: "script", children: themeScript(), injectTo: "head" }];
    },
  };
}
