import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { auth, googleProvider, db } from "./firebase";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

export type AuthSubscriber = (user: User | null) => void;

export function subscribeToAuth(cb: AuthSubscriber) {
  return onAuthStateChanged(auth, cb);
}

export async function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail(email: string, password: string) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(cred.user);
  return cred;
}

export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await ensureUserDoc(cred.user);
  return cred;
}

export async function signOut() {
  await fbSignOut(auth);
}

async function ensureUserDoc(user: User) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    email: user.email,
    display_name: user.displayName,
    photo_url: user.photoURL,
    created_at: serverTimestamp(),
    preferences: {
      sensitivity: "medium",
      enabled_types: ["price_surge", "price_dump", "volume_spike", "breakout"],
      min_score: 0,
      muted_coins: [],
      plan: "free",
    },
    fcm_tokens: [],
  });
}
