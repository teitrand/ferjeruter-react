import { useEffect, useRef, useState } from "react";
import { appMode } from "../../../packages/core/index.js";

/**
 * Install-knappen som bindInstallPrompt() i vanilla-appen:
 * - skjult når sida alt er opna som installert app
 * - har nettlesaren eiga installering (beforeinstallprompt), blir ho brukt
 * - elles opnar knappen rettleiinga (`help`)
 * `early` (captureInstallPrompt i pwa/register.js) har hendinga om ho kom før React
 * monterte. Nettlesaren tilbyr installering berre med manifest (og service worker).
 * @returns {{ visible: boolean, helpOpen: boolean, install: () => void, closeHelp: () => void }}
 */
export function useInstall(track, { enabled = true, early = null } = {}) {
  const [visible, setVisible] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const deferred = useRef(null);

  useEffect(() => {
    if (!enabled || appMode(window) === "pwa") return undefined;
    setVisible(true);
    const onPrompt = (event) => {
      event.preventDefault?.();
      deferred.current = event;
      setVisible(true);
    };
    const pending = early?.take();
    if (pending) deferred.current = pending;
    const onInstalled = () => {
      track("App installed", { how: "native" });
      deferred.current = null;
      setVisible(false);
      setHelpOpen(false);
    };
    // Med `early` lyttar han alt på window (og kallar preventDefault); elles gjer vi det her.
    const unsubscribe = early ? early.subscribe(onPrompt) : null;
    if (!early) window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      unsubscribe?.();
      if (!early) window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [enabled, track, early]);

  const install = async () => {
    const prompt = deferred.current;
    if (prompt) {
      track("Install app", { how: "native" });
      deferred.current = null;
      prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === "accepted") setVisible(false);
      return;
    }
    track("Install app", { how: "help" });
    setHelpOpen(true);
  };

  return { visible, helpOpen, install, closeHelp: () => setHelpOpen(false) };
}
