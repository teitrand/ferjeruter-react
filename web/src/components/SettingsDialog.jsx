import { useRef } from "react";
import { useAnnounce } from "./Announcer.jsx";
import { t } from "./i18n.js";
import { closeOnBackdrop, useModal } from "./useModal.js";

export const LANGS = [
  { value: "nn", label: "Nynorsk", lang: "nn", said: "Språk: Nynorsk" },
  { value: "en", label: "English", lang: "en", said: "Language: English" },
  { value: "de", label: "Deutsch", lang: "de", said: "Sprache: Deutsch" },
];

const Check = () => (
  <svg className="seg-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Eit val av tre i ei gruppe (Designer): ekte radioknappar (piltastar, Tab, valt val i tilgjengeleg tre), valt val har hake og
 * fylt bakgrunn, aldri berre farge. Radioen er visuelt skjult; heile etiketten er trykkflata (≥ 44 px).
 */
function Segmented({ legend, name, value, options, onChange, hint = null }) {
  return (
    <fieldset className="seg-group">
      <legend>{legend}</legend>
      <div className="seg">
        {options.map((option) => (
          <label key={option.value} className={value === option.value ? "seg-opt is-selected" : "seg-opt"} lang={option.lang}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            {value === option.value ? <Check /> : null}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint ? <p className="seg-hint">{hint}</p> : null}
    </fieldset>
  );
}

/**
 * «Innstillingar»: språk og tema i éi modal dialog, opna frå tannhjulet øvst til høgre. Esc, «Ferdig» og trykk utanfor lukkar.
 * Valet blir husket av dei som eig det (setLang/App og useTheme). Språkbyte blir sagt frå om i den felles live-regionen.
 */
export function SettingsDialog({ open, onClose, lang, onLang, themeState }) {
  const ref = useRef(null);
  const announce = useAnnounce();
  useModal(ref, open);
  const themes = ["system", "light", "dark"].map((value) => ({ value, label: t(`theme.${value}`) }));
  const changeLang = (code) => {
    onLang(code);
    announce(LANGS.find((entry) => entry.value === code)?.said);
  };
  return (
    <dialog ref={ref} id="settings-dialog" className="settings-dialog" aria-labelledby="settings-title" onClose={onClose} onClick={closeOnBackdrop(ref)}>
      <h2 id="settings-title">{t("settings.title")}</h2>
      <Segmented legend={t("lang.label")} name="lang" value={lang} options={LANGS} onChange={changeLang} />
      {themeState ? (
        <Segmented legend={t("theme.label")} name="theme" value={themeState.pref} options={themes} onChange={themeState.setPref} hint={t("settings.themeHint")} />
      ) : null}
      <button type="button" className="settings-done" onClick={() => ref.current?.close()}>
        {t("settings.done")}
      </button>
    </dialog>
  );
}
