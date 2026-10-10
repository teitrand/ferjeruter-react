import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../assets/styles.css";
import "./styles/crossing.css";
import "./styles/nowcard.css";
import "./styles/picker.css";
import { App } from "./App.jsx";
import { AnnouncerProvider } from "./components/Announcer.jsx";
import { detectLang } from "./components/i18n.js";
import { routeFromQuery, routeOverride } from "../../packages/core/index.js";
import { dataBase, liveDataBase } from "./model/data.js";
import {
  browserMemory,
  messageCache,
  readHideArrivals,
  readLastMode,
  readRouteChoice,
  timetableCache,
  writeRouteChoice,
} from "./model/storage.js";
import { captureInstallPrompt, createPwaEvents, registerServiceWorker } from "./pwa/register.js";
import { initialUi } from "./state.js";

// Før React: beforeinstallprompt kan kome tidleg, og service workeren bør starte med ein gong.
const installPrompt = captureInstallPrompt(window);
const pwaEvents = createPwaEvents();
registerServiceWorker(pwaEvents, { enabled: import.meta.env.PROD, baseUrl: import.meta.env.BASE_URL });

// ?samband= vinn over det lagra valet ved oppstart, og blir hugsa.
const fromQuery = routeFromQuery(location);
if (fromQuery) writeRouteChoice(fromQuery);

const initialState = initialUi({
  routeChoice: fromQuery || readRouteChoice(),
  lang: detectLang(),
  override: routeOverride(location),
  hideArrivals: readHideArrivals(),
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AnnouncerProvider>
    <App
      dataBase={dataBase(import.meta.env)}
      liveDataBase={liveDataBase(import.meta.env, location)}
      messageCache={messageCache()}
      timetableCache={timetableCache()}
      lastMode={readLastMode()}
      pwaEvents={pwaEvents}
      installPrompt={installPrompt}
      initialState={initialState}
      memory={browserMemory()}
    />
    </AnnouncerProvider>
  </StrictMode>
);
