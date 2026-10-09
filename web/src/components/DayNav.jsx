import { headingDay } from "../../../packages/core/index.js";
import { t } from "./i18n.js";

/** `error`: rutetabellen kunne ikkje lastast og finst ikkje i cachen (som loadRoutes i vanilla). */
export function DayNav({ date, isToday, loading, error = false, onDay }) {
  return (
    <div className="daynav" role="group" aria-label={t("day.navAria")}>
      <button type="button" className="daybtn daybtn-today" disabled={isToday} onClick={() => onDay(0)}>
        {t("day.today")}
      </button>
      <button type="button" className="daybtn" aria-label={t("day.prev")} onClick={() => onDay(-1)}>
        ‹
      </button>
      <h2 id="day-label" className="day-label">
        {error ? t("timetable.loadError") : loading ? t("day.loading") : headingDay(date)}
      </h2>
      <button type="button" className="daybtn" aria-label={t("day.next")} onClick={() => onDay(1)}>
        ›
      </button>
    </div>
  );
}
