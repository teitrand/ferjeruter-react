import { useAnnounce } from "./Announcer.jsx";
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

/** Rekkjefølgje: følg eininga → lys → mørk → følg eininga. */
export const THEME_CYCLE = ["system", "light", "dark"];
export const nextThemePref = (pref) => THEME_CYCLE[(THEME_CYCLE.indexOf(pref) + 1) % THEME_CYCLE.length];

/**
 * Éin liten knapp (44 px, berre ikon) som bladar Enhet → Lys → Mørk. Ikonet viser valet no (skjerm = følg eininga, sol = lys,
 * måne = mørk). Namnet seier kva som er valt og kva trykket gjev: «Tema: Enhet. Byt til Lys». Valet blir husket (useTheme) og sagt frå om.
 */
export function ThemeSwitch({ pref, onChange }) {
  const announce = useAnnounce();
  const next = nextThemePref(pref);
  const name = (value) => t(`theme.${value}`);
  return (
    <button
      type="button"
      className="theme-btn"
      data-theme-pref={pref}
      aria-label={t("theme.cycle", { current: name(pref), next: name(next) })}
      title={t("theme.cycle", { current: name(pref), next: name(next) })}
      onClick={() => {
        onChange(next);
        announce(`${t("theme.label")}: ${name(next)}`);
      }}
    >
      <svg className="theme-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        {ICONS[pref] || ICONS.system}
      </svg>
    </button>
  );
}
