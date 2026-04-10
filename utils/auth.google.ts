import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "../utils/firebase";

export type AuthGateState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "allowed"; user: User };

const provider = new GoogleAuthProvider();
// optional: restrict to Google accounts only (usually not needed)
// provider.setCustomParameters({ hd: "gmail.com" });

export async function signInWithGoogle() {
  const auth = getFirebaseAuth();
  await setPersistence(auth, browserLocalPersistence);

  try {
    const cred = await signInWithPopup(auth, provider);
    console.log("Signed in:", cred.user.uid, cred.user.email);
    return cred.user;
  } catch (e) {
    console.error("Google popup sign-in failed:", e);
    throw e;
  }
}

export async function completeRedirectIfNeeded() {
  const auth = getFirebaseAuth();
  try {
    await getRedirectResult(auth);
  } catch (e) {
    console.error("getRedirectResult failed:", e);
  }
}

export async function logout() {
  const auth = getFirebaseAuth();
  await signOut(auth);
}

/**
 * Auth gate: waits for auth state, then allows any signed-in Google user.
 */
export function subscribeAuthGate(onState: (s: AuthGateState) => void) {
  const auth = getFirebaseAuth();

  onState({ status: "loading" });

  return onAuthStateChanged(auth, (user) => {
    if (!user || user.isAnonymous) {
      onState({ status: "signedOut" });
    } else {
      onState({ status: "allowed", user });
    }
  });
}