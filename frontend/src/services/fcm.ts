import { getToken, onMessage } from "firebase/messaging";
import { getMessagingIfSupported } from "./firebase";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const res = await Notification.requestPermission();
  return res === "granted";
}

export async function obtainFcmToken(): Promise<string | null> {
  if (!VAPID_KEY) {
    console.warn("VITE_FIREBASE_VAPID_KEY missing; FCM web push disabled.");
    return null;
  }
  const messaging = await getMessagingIfSupported();
  if (!messaging) return null;
  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    return token || null;
  } catch (e) {
    console.warn("getToken failed", e);
    return null;
  }
}

export async function listenForForegroundMessages(handler: (payload: any) => void) {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return () => {};
  return onMessage(messaging, handler);
}
