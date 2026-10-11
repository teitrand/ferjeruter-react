import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { activeMode, appMode, chosenRoute, isMultiFerryRoute, legsForDate, nowMinutes, osloIsoFromMs, shiftIso, todayIso } from "../../packages/core/index.js";
import { DayNav } from "./components/DayNav.jsx";
import { DepartureDialog } from "./components/DepartureDialog.jsx";
import { FeedbackDialog } from "./components/FeedbackDialog.jsx";
import { Footnote } from "./components/Footnote.jsx";
import { Footer } from "./components/Footer.jsx";
import { Header } from "./components/Header.jsx";
import { InstallDialog } from "./components/InstallDialog.jsx";
import { MessagesPanel } from "./components/MessagesPanel.jsx";
import { Timeline } from "./components/Timeline.jsx";
import { ExtrasRow, PlaceFilter } from "./components/TripControls.jsx";
import { setLang, t } from "./components/i18n.js";
import { TrackContext } from "./components/track.js";
import { useAppData } from "./hooks/useAppData.js";
import { useClock } from "./hooks/useClock.js";
import { useEntur } from "./hooks/useEntur.js";
import { useInstall } from "./hooks/useInstall.js";
import { useMessages } from "./hooks/useMessages.js";
import { useOnline } from "./hooks/useOnline.js";
import { useSanntid } from "./hooks/useSanntid.js";
import { useSignalLog } from "./hooks/useSignalLog.js";
import { signalLogUrls } from "./model/signallog.js";
import { useTheme } from "./hooks/useTheme.js";
import { useWake } from "./hooks/useWake.js";
import { hasTimetable, isTodaySelected, memoryOnly, planContext, rememberBookings, selectedDate, statusEvidence } from "./model/context.js";
import { connectionModel, detailModel, messagesModel, placeFilterModel, staleChoices } from "./model/controls.js";
import { rememberEntur, withEntur } from "./model/entur.js";
import { ferryRows } from "./model/ferries.js";
import { sanntidMode, sanntidUrl, withSanntid } from "./model/sanntid.js";
import { chromeForMode, footnoteModel, ledeModel, routeChrome } from "./model/header.js";
import { routePicker } from "./model/routes.js";
import { RoutePicker } from "./components/RoutePicker.jsx";
import { FerryList } from "./components/FerryList.jsx";
import { NowCard } from "./components/NowCard.jsx";
import { markPwaFirstOpen, syncRouteQuery, writeHideArrivals, writeLastMode, writeRouteChoice } from "./model/storage.js";
import { buildTimeline } from "./model/timeline.js";
import { actionEvent, track as sendEvent, visitEvents } from "./model/track.js";
import { initialUi, uiReducer } from "./state.js";

const NO_CONNECTION = { lines: [], value: null, footnote: "" };

/**
 * Skalet. Tre kjelder til tilstand:
 * - `ui` (reducer): samband, dag, språk, vis tidlegare, frå/til, ankomsttider,
 *   korrespondanse, meldingsfilter og opent detaljvindauge
 * - `data` (useAppData + useMessages + useEntur): rutetabell, kombirute, meldingar,
 *   signallogg, korrespondanse, sanntid, avlysingar og faktiske avgangar
 * - `memory` (ref): bestilte/køyrde signalturar som appen hugsar gjennom dagen
 * Alt anna blir rekna ut av modellen (src/model) ved kvar teikning. Modellen les
 * minnet, men endrar det berre i effektane under.
 *
 * Props er for testar og SSR: fast data, fast Entur-tilstand, fast UI og minne utan localStorage.
 * `liveDataBase` er der meldingar og signallogg ligg (produksjonsfilene på /dev/, sjå data.js),
 * `messageCache` er localStorage-lageret for meldingar (null = ingen).
 *
 * PWA (berre i nettlesaren, null i testar): `timetableCache` er rutetabellen i localStorage,
 * `lastMode` sambandet som galdt i dag sist (tittel utan blink), `pwaEvents` meldingane frå
 * service workeren, `installPrompt` beforeinstallprompt fanga før React monterte.
 * Sida vaknar (useWake): meldingar og sanntid blir henta på nytt.
 *
 * Plausible: kvar handling går via `act`, som sender same hending som vanilla-appen
 * (model/track.js) før reduceren får ho. Ringelenkjer, installering og tilbakemelding
 * sender sjølve via TrackContext.
 */
export function App({
  dataBase = "./data/",
  liveDataBase = dataBase,
  messageCache = null,
  timetableCache = null,
  lastMode = null,
  pwaEvents = null,
  installPrompt = null,
  initialData = null,
  initialEntur = null,
  initialSanntid = null,
  sanntid: sanntidEndpoint = sanntidUrl(import.meta.env),
  initialState = null,
  memory: givenMemory = null,
}) {
  const [ui, dispatch] = useReducer(uiReducer, initialState, (given) => ({ ...initialUi(), ...given }));
  const live = !initialData;
  const woke = useWake({ enabled: live, events: pwaEvents });
  const { data: loaded, status } = useAppData(dataBase, initialData, liveDataBase, {
    cache: timetableCache,
    reload: woke.timetable,
  });
  const { messages, failed: messagesFailed } = useMessages(liveDataBase, loaded.messages, {
    live,
    // Som vanilla: meldingane blir henta òg når rutetabellen feilar.
    ready: status !== "loading",
    cache: messageCache,
    refresh: woke.wake + woke.messages,
  });
  // Signalloggen: workeren (heimeserveren) og fila på Pages, nyaste vinn. Blir henta på nytt medan sida står open (kvart 5. minutt og når ho vaknar).
  const signalLog = useSignalLog(signalLogUrls(liveDataBase, sanntidEndpoint), loaded.signalLog, { live, ready: status !== "loading", refresh: woke.wake + woke.timetable });
  const base = useMemo(() => ({ ...loaded, messages, signalLog }), [loaded, messages, signalLog]);
  const clockMs = useClock(woke.wake);
  const entur = useEntur(base, ui, clockMs, initialEntur);
  const online = useOnline();
  // AIS (workeren) er sanninga for posisjon, så Entur, så rutetabellen (core bestFix). Feilar workeren,
  // held vi siste posisjon som eldast av seg sjølv; då tek Entur over. `initialSanntid` er for testar og SSR.
  const sanntid = useSanntid(base, ui, { url: sanntidEndpoint, enabled: live, initial: initialSanntid });
  const sanntidOn = Boolean(initialSanntid) || (live && Boolean(sanntidEndpoint));
  const mode = hasTimetable(base) ? sanntidMode(base, ui) : null;
  const data = useMemo(
    () => withSanntid(withEntur(base, entur, { offline: !online }), sanntid, mode, { on: sanntidOn }),
    [base, entur, online, sanntid, mode, sanntidOn]
  );
  const memoryRef = useRef(givenMemory);
  memoryRef.current ??= memoryOnly();
  const memory = memoryRef.current;
  // Teikn på nytt når effektane under har endra minnet.
  const [memoryVersion, setMemoryVersion] = useState(0);

  // i18n har éin global språkvariabel. Set han før komponentane omset noko.
  setLang(ui.lang, { persist: false });

  const ready = hasTimetable(data);
  const now = nowMinutes(clockMs);
  const chrome = useMemo(() => (ready ? routeChrome(data, ui) : null), [ready, data, ui]);
  // Før data: sambandet frå sist i dag, så tittelen er rett med ein gong.
  const todaySelected = isTodaySelected(ui);
  const headerChrome = useMemo(
    () => chrome || (lastMode && todaySelected ? chromeForMode(lastMode) : null),
    [chrome, lastMode, todaySelected]
  );
  const todayMode = useMemo(() => (ready ? routeChrome(data, { ...ui, date: null }).mode : null), [ready, data, ui]);
  const place = ready ? placeFilterModel(data, ui) : null;
  const filters = place?.filters;
  // Ankomsttida står på avgangsrada når ankomstar er på og ingen frå/til-filter gøymer rada: då gjentek ikkje «No» ho.
  const lede = ready ? ledeModel(data, ui, memory, now, { arrivalShown: !ui.hideArrivals && !filters?.from && !filters?.to }) : null;
  const connection = ready ? connectionModel(data, ui) : NO_CONNECTION;
  const panel = messagesModel(data, ui, clockMs);
  const timeline = useMemo(
    () => (ready ? buildTimeline(data, { ...ui, filters, connection: connection.value }, memory, { now }) : null),
    // memoryVersion: minnet er ein ref, så endringar der må gje ny tidslinje.
    [ready, data, ui, filters, connection.value, memory, now, memoryVersion]
  );
  // «No»-kortet er eit punkt på tidslinja (berre i dag). Finst ikkje hendinga (t.d. tom liste), står kortet over lista.
  const nowCard =
    ready && todaySelected && lede && !lede.noTrips && lede.card ? <NowCard base={lede.card} live={lede.live} /> : null;
  const nowInTimeline = Boolean(nowCard && timeline?.rows?.some((row) => row.kind === "now"));
  // Samband med fleire ferjer (1069): ei tekstrad per ferje i staden for «No»-kortet.
  const ferries = useMemo(() => {
    if (!ready || !todaySelected || !isMultiFerryRoute(activeMode(planContext(data, ui)))) return null;
    const ctx = planContext(data, { ...ui, date: null });
    const today = legsForDate(todayIso(), ctx);
    return ferryRows({
      data,
      quays: [...new Set(today.flatMap((leg) => [leg.from, leg.to]))],
      today,
      tomorrow: legsForDate(shiftIso(todayIso(), 1), ctx),
      now,
      ev: statusEvidence(data, ui, memory, ctx),
      nowMs: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, todaySelected, data, ui, memory, memoryVersion, now, clockMs]);
  const detail = ui.detail && ready ? detailModel(data, ui, memory, ui.detail, now) : null;
  const notes = footnoteModel(data, ui, chrome);

  // Plausible. uiRef gjev hendingane gjeldande språk og samband utan å lage nye funksjonar.
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const win = live && typeof window !== "undefined" ? window : null;
  const track = useCallback((name, props, opts) => sendEvent(win, name, props, uiRef.current, opts), [win]);
  const act = useCallback(
    (action) => {
      const event = actionEvent(action, uiRef.current);
      if (event) sendEvent(win, event.name, event.props, event.ui || uiRef.current);
      dispatch(action);
    },
    [win]
  );
  const visited = useRef(false);
  useEffect(() => {
    // Éin gong per opning, òg når StrictMode køyrer effekten to gonger.
    if (!win || visited.current) return;
    visited.current = true;
    const mode = appMode(win);
    for (const name of visitEvents(uiRef.current, mode, markPwaFirstOpen(mode))) {
      sendEvent(win, name, null, uiRef.current, { interactive: false });
    }
  }, [win]);
  const install = useInstall(track, { enabled: live, early: installPrompt });
  const themeState = useTheme();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    if (!hasTimetable(base)) return;
    if (rememberEntur(memory, base, ui, entur)) setMemoryVersion((v) => v + 1);
  }, [memory, base, ui, entur, clockMs]);

  const remember = timeline?.remember;
  useEffect(() => {
    if (rememberBookings(memory, remember)) setMemoryVersion((v) => v + 1);
  }, [memory, remember]);

  // Val som ikkje gjeld lenger (anna dag eller samband), blir gløymde som i vanilla-appen.
  const stale = ready ? staleChoices(ui, place, connection, panel) : null;
  useEffect(() => {
    if (stale) dispatch({ type: "sanitize", patch: stale });
  });

  useEffect(() => {
    document.documentElement.lang = ui.lang;
    if (headerChrome) document.title = t(headerChrome.metaTitleKey);
  }, [ui.lang, headerChrome]);

  // Som writeLastMode i vanilla: sambandet som gjeld i dag, til neste opning.
  useEffect(() => {
    if (live && todayMode) writeLastMode(todayMode);
  }, [live, todayMode]);

  const onRoute = (route) => {
    writeRouteChoice(route);
    if (live) syncRouteQuery(route);
    act({ type: "route", route });
  };
  const onLang = (lang) => {
    setLang(lang);
    act({ type: "lang", lang });
  };
  const onToggleArrivals = () => {
    writeHideArrivals(!ui.hideArrivals);
    act({ type: "toggleArrivals" });
  };

  return (
    <TrackContext.Provider value={track}>
      <a className="skip-link" href="#innhald">
        {t("skip")}
      </a>
      <div className="skyline" aria-hidden="true" />
      <Header chrome={headerChrome} lede={lede} ui={ui} onLang={onLang} install={install} themeState={themeState} />
      <main id="innhald">
        <div className={panel.hidden && !messagesFailed ? "layout is-single" : "layout"} id="layout">
          <MessagesPanel
            failed={messagesFailed}
            panel={panel}
            route={chosenRoute(ui)}
            expanded={ui.messagesExpanded}
            onToggle={() => act({ type: "toggleMessages" })}
            onFilter={(filter) => act({ type: "messageFilter", filter })}
          />
          <section className="panel" aria-labelledby="day-label" id="timetable-panel">
            <DayNav
              date={selectedDate(ui)}
              isToday={isTodaySelected(ui)}
              loading={!ready && status === "loading"}
              error={!ready && status === "error"}
              onDay={(days) => act({ type: "day", days })}
            />
            {place ? <PlaceFilter place={place} dispatch={act} /> : null}
            {ready ? (
              <ExtrasRow
                showArrivals={!ui.hideArrivals}
                onToggleArrivals={onToggleArrivals}
                connection={connection}
                onConnection={(id) => act({ type: "connection", id })}
              />
            ) : null}
            {nowCard && !nowInTimeline ? nowCard : null}
            {ferries ? <FerryList model={ferries} /> : null}
            {ready ? <h2 className="trips-heading">{t("trips.heading")}</h2> : null}
            {status === "error" && !ready ? (
              <div className="timeline">
                <p className="empty">{t("timetable.notLoaded")}</p>
              </div>
            ) : timeline ? (
              <Timeline
                timeline={timeline}
                showPast={ui.showPast}
                onTogglePast={() => act({ type: "togglePast" })}
                onDetail={(leg) => act({ type: "detail", leg })}
                nowSlot={nowInTimeline ? nowCard : null}
              />
            ) : null}
            <Footnote notes={notes} connection={connection.footnote} />
          </section>
        </div>
      </main>
      <Footer chrome={chrome} notes={notes} onFeedback={() => setFeedbackOpen(true)} />
      <RoutePicker picker={routePicker(data, ui, now, osloIsoFromMs(clockMs))} onSelect={onRoute} />
      <InstallDialog open={install.helpOpen} onClose={install.closeHelp} />
      <DepartureDialog detail={detail} onClose={() => dispatch({ type: "detail", leg: null })} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </TrackContext.Provider>
  );
}
