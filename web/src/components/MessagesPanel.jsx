import { FJORD1_SMS_URL, messageMergeKey, messageTimeLines } from "../../../packages/core/index.js";
import { t } from "./i18n.js";

function MessageCard({ msg }) {
  const times = messageTimeLines(msg);
  return (
    <article className={`card is-${msg.severity}`}>
      <h3>
        {msg.heading || t("messages.heading")}
        <span className={`badge badge-${msg.severity}`}>{t(`severity.${msg.severity}`) || t("severity.info")}</span>
      </h3>
      <p>{msg.text}</p>
      {times.length ? (
        <p className="card-times">
          {times.map((line) => (
            <time key={line.iso + line.text} dateTime={line.iso}>
              {line.text}
            </time>
          ))}
        </p>
      ) : null}
    </article>
  );
}

/** Stripa øvst i panelet: tittel, tal, utdrag og «vis/skjul». */
function SummaryBar({ messages, expanded, onToggle }) {
  const top = messages[0];
  const excerpt = top ? String(top.text || "").replace(/\s+/g, " ").trim() : t("empty.noMessages");
  return (
    <button type="button" className={`messages-bar is-${top ? top.severity : "info"}`} aria-expanded={expanded} onClick={onToggle}>
      <span className="messages-bar-head">
        <span className="messages-bar-title">{t("messages.title")}</span>
        {top ? (
          <span className="messages-count" aria-label={t("messages.countAria", { n: messages.length })}>
            {messages.length}
          </span>
        ) : null}
        <span className="messages-bar-toggle">{expanded ? t("messages.collapse") : t("messages.expand")}</span>
      </span>
      {expanded ? null : (
        <span className="messages-bar-body">
          <span className="messages-bar-excerpt">{excerpt}</span>
          {messages.length > 1 ? (
            <span className="messages-bar-more">{t("messages.andNMore", { n: messages.length - 1 })}</span>
          ) : null}
        </span>
      )}
    </button>
  );
}

/**
 * Verken fila, Fjord1 eller cachen gav meldingar. Vanilla skriv same tekstane inn i eit
 * gøymt panel; her blir dei viste, med lenkje til Fjord1.
 */
function MessagesError() {
  return (
    <section className="panel panel-messages" id="messages-panel" aria-labelledby="meldingar-title">
      <div className="panel-head">
        <h2 id="meldingar-title" className="visually-hidden">
          {t("messages.title")}
        </h2>
        <p className="meta" id="messages-meta">
          {t("messages.fetchError")}
        </p>
      </div>
      <div id="messages" className="message-list">
        <p className="empty">
          <a href="https://www.fjord1.no/trafikkmeldingar" target="_blank" rel="noreferrer">
            {t("messages.seeFjord1")}
          </a>
        </p>
      </div>
    </section>
  );
}

/** Trafikkmeldingar. `panel` kjem frå messagesPanel i core (via model/controls.js). */
export function MessagesPanel({ panel, route, expanded, onToggle, onFilter, failed = false }) {
  if (failed) return <MessagesError />;
  if (panel.hidden) return null;
  return (
    <section className="panel panel-messages" id="messages-panel" aria-labelledby="meldingar-title">
      <div id="messages-summary" className="messages-summary">
        <SummaryBar messages={panel.messages} expanded={expanded} onToggle={onToggle} />
      </div>
      <div id="messages-details" className="messages-details" hidden={!expanded}>
        <div className="panel-head">
          <h2 id="meldingar-title" className="visually-hidden">
            {t("messages.title")}
          </h2>
          <p className="meta" id="messages-meta">
            {panel.meta}
          </p>
        </div>
        <div className="filters" role="group" aria-label={t("messages.filterAria")} hidden={!panel.filters.length}>
          {["local", "route"].map((key) => (
            <button
              key={key}
              type="button"
              className={key === panel.filter ? "chip is-active" : "chip"}
              data-filter={key}
              aria-pressed={key === panel.filter}
              onClick={() => onFilter(key)}
            >
              {key === "route" ? t("messages.filterRoute", { n: route }) : t("messages.filterLocal")}
            </button>
          ))}
        </div>
        <div id="messages" className="message-list">
          {panel.messages.length ? (
            panel.messages.map((msg) => <MessageCard key={msg.id || messageMergeKey(msg)} msg={msg} />)
          ) : (
            <p className="empty">{t("empty.noMessages")}</p>
          )}
        </div>
        <p className="footnote">
          <span>{t("messages.source")}</span>:{" "}
          <a href="https://www.fjord1.no/trafikkmeldingar" target="_blank" rel="noreferrer">
            fjord1.no/trafikkmeldingar
          </a>{" "}
          ·{" "}
          <a href={FJORD1_SMS_URL} target="_blank" rel="noreferrer">
            {t("messages.sms")}
          </a>
        </p>
      </div>
    </section>
  );
}
