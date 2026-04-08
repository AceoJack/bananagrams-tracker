import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { getFirebaseApp, getFirebaseAuth } from "./firebase";

export async function ensureSignedIn(): Promise<string> {
  const auth = getFirebaseApp();

  // Wait briefly for Firebase to hydrate existing session
  const uid = await new Promise<string | null>((resolve) => {
    const unsub = onAuthStateChanged(getFirebaseAuth(), (user) => {
      unsub();
      resolve(user?.uid ?? null);
    });
  });

  if (uid) return uid;

  const cred = await signInAnonymously(getFirebaseAuth());
  return cred.user.uid;
}