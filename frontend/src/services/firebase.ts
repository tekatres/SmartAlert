import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, Auth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getFunctions, Functions } from "firebase/functions";
import { getMessaging, Messaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseApp: FirebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(firebaseApp);
export const db: Firestore = getFirestore(firebaseApp);
export const googleProvider = new GoogleAuthProvider();

let _functions: Functions | null = null;
export function getFunctionsInstance(): Functions {
  if (_functions) return _functions;
  _functions = getFunctions(firebaseApp, "us-central1");
  return _functions;
}

let _messaging: Messaging | null = null;
export async function getMessagingIfSupported(): Promise<Messaging | null> {
  if (_messaging) return _messaging;
  const ok = await isSupported();
  if (!ok) return null;
  _messaging = getMessaging(firebaseApp);
  return _messaging;
}
