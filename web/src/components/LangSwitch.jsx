import { useAnnounce } from "./Announcer.jsx";
import { t } from "./i18n.js";

const FLAGS = {
  nn: (
    <svg viewBox="0 0 22 16" focusable="false">
      <rect width="22" height="16" fill="#ba0c2f" />
      <rect x="6" width="4" height="16" fill="#fff" />
      <rect y="6" width="22" height="4" fill="#fff" />
      <rect x="7" width="2" height="16" fill="#00205b" />
      <rect y="7" width="22" height="2" fill="#00205b" />
    </svg>
  ),
  en: (
    <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" focusable="false">
      <rect width="60" height="30" fill="#012169" />
      <path d="M0 0l60 30M60 0L0 30" stroke="#fff" strokeWidth="6" />
      <path d="M0 0l60 30M60 0L0 30" stroke="#c8102e" strokeWidth="4" />
      <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
      <path d="M30 0v30M0 15h60" stroke="#c8102e" strokeWidth="6" />
    </svg>
  ),
  de: (
    <svg viewBox="0 0 16 12" focusable="false">
      <rect width="16" height="4" fill="#000" />
      <rect y="4" width="16" height="4" fill="#d00" />
      <rect y="8" width="16" height="4" fill="#ffce00" />
    </svg>
  ),
};

const LANGS = [
  { code: "nn", label: "Nynorsk", said: "Språk: Nynorsk" },
  { code: "en", label: "English", said: "Language: English" },
  { code: "de", label: "Deutsch", said: "Sprache: Deutsch" },
];

/** Språkval med flagg: nynorsk, engelsk og tysk. Språkbyte blir sagt frå om i den felles live-regionen. */
export function LangSwitch({ lang, onChange }) {
  const announce = useAnnounce();
  return (
    <div className="lang-switch" role="group" aria-label={t("lang.label")}>
      {LANGS.map(({ code, label, said }) => (
        <button
          key={code}
          type="button"
          className={lang === code ? "lang-btn is-active" : "lang-btn"}
          lang={code}
          aria-label={label}
          title={label}
          aria-pressed={lang === code}
          onClick={() => {
            onChange(code);
            announce(said);
          }}
        >
          <span className="lang-flag" aria-hidden="true">
            {FLAGS[code]}
          </span>
          <span className="lang-code">{code.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}
