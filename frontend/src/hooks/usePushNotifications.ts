import { useCallback, useEffect } from "react";
import {
  listenForForegroundMessages,
  obtainFcmToken,
  requestNotificationPermission,
} from "@/services/fcm";
import { registerFcmTokenFn } from "@/services/alerts";
import { useAppStore } from "@/store/useAppStore";

export function usePushNotifications() {
  const user = useAppStore((s) => s.user);

  const enable = useCallback(async () => {
    const granted = await requestNotificationPermission();
    if (!granted) return false;
    const token = await obtainFcmToken();
    if (token && user) {
      try {
        await registerFcmTokenFn({
          token,
          platform: "web",
          device_id: navigator.userAgent,
        });
      } catch (e) {
        console.warn("Failed to register FCM token", e);
      }
    }
    return !!token;
  }, [user]);

  useEffect(() => {
    const unsub = listenForForegroundMessages((payload) => {
      console.log("FCM foreground message", payload);
    });
    return () => {
      unsub.then((fn) => fn?.());
    };
  }, []);

  return { enable };
}
