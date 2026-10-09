import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../assets/styles.css";
import { App } from "./App.jsx";
import { detectLang } from "./components/i18n.js";
import { routeOverride } from "../../packages/core/index.js";
import { dataBase, liveDataBase } from "./model/data.js";
import {
  browserMemory,
  messageCache,
  readHideArrivals,
  readLastMode,
  readRouteChoice,
  timetableCache,
} from "./model/storage.js";
import { captureInstallPrompt, createPwaEvents, registerServiceWorker } from "./pwa/register.js";
import { initialUi } from "./state.js";

// Før React: beforeinstallprompt kan kome tidleg, og service workeren bør starte med ein gong.
const installPrompt = captureInstallPrompt(window);
const pwaEvents = createPwaEvents();
registerServiceWorker(pwaEvents, { enabled: import.meta.env.PROD, baseUrl: import.meta.env.BASE_URL });

const initialState = initialUi({
  routeChoice: readRouteChoice(),
  lang: detectLang(),
  override: routeOverride(location),
  hideArrivals: readHideArrivals(),
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
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
  </StrictMode>
);
