import { t } from "./i18n.js";

const ICONS = {
  system: (
    <>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.6" />
      <path d="M7 17h6M10 13.5V17" />
    </>
  ),
  light: (
    <>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4" />
    </>
  ),
  dark: <path d="M16.2 11.6A6.6 6.6 0 0 1 8.4 3.8a6.6 6.6 0 1 0 7.8 7.8z" />,
};

const OPTIONS = ["system", "light", "dark"];

/**
 * Tre val: Enhet (følg eininga) / Lys / Mørk. Knappar med aria-pressed i ei merkt gruppe (Tab og Enter/mellomrom).
 * Teksten står alltid synleg ved sida av ikonet, så valet er forståeleg utan å gjette på symbol.
 */
export function ThemeSwitch({ pref, theme, onChange }) {
  return (
    <div className="theme-switch" role="group" aria-label={t("theme.label")}>
      {OPTIONS.map((value) => {
        const title = value === "system" ? t("theme.systemTitle", { theme: t(`theme.${theme}`) }) : t(`theme.${value}Title`);
        return (
          <button
            key={value}
            type="button"
            className={pref === value ? "lang-btn theme-btn is-active" : "lang-btn theme-btn"}
            data-theme-pref={value}
            aria-pressed={pref === value}
            title={title}
            onClick={() => onChange(value)}
          >
            <svg className="theme-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              {ICONS[value]}
            </svg>
            <span>{t(`theme.${value}`)}</span>
          </button>
        );
      })}
    </div>
  );
}
