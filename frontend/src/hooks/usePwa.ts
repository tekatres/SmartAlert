// Hooks for PWA: install prompt + update notification.
import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export function usePwaInstall() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install(): Promise<boolean> {
    if (!event) return false;
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === "accepted";
  }

  return { canInstall: !!event, installed, install };
}

export function usePwaUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl) {
      console.log("SW registered:", swUrl);
    },
    onRegisterError(err) {
      console.warn("SW registration error:", err);
    },
  });

  return { needRefresh, applyUpdate: () => updateServiceWorker(true), dismiss: () => setNeedRefresh(false) };
}
