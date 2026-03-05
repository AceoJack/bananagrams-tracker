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
import { getDoc, doc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "../utils/firebase";

export type AuthGateState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "notAllowed"; email: string; uid: string }
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
 * Checks whether this user is allowlisted in Firestore:
 * allowedUsers/{uid} with fields { enabled: true, email: <google email> }
 */
export async function checkUserAllowed(user: User): Promise<boolean> {
  const db = getFirebaseDb();
  const ref = doc(db, "allowedUsers", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;

  const data = snap.data() as any;
  if (data.enabled !== true) return false;

  // enforce email match (prevents someone reusing a UID doc if auth changes)
  const email = (user.email ?? "").toLowerCase();
  const allowedEmail = String(data.email ?? "").toLowerCase();
  if (!email || email !== allowedEmail) return false;

  return true;
}

/**
 * Auth gate: waits for auth state, then enforces allowlist.
 */
export function subscribeAuthGate(onState: (s: AuthGateState) => void) {
  const auth = getFirebaseAuth();

  onState({ status: "loading" });

  return onAuthStateChanged(auth, async (user) => {
    console.log("Auth state:", user?.uid, user?.email);
    if (!user) {
      onState({ status: "signedOut" });
      return;
    }

    const ok = await checkUserAllowed(user);
    if (!ok) {
      const email = user.email ?? "(no email returned)";
      const uid = user.uid;
      onState({ status: "notAllowed", email, uid });
      // optional: force sign-out so they can't keep trying reads
      //await signOut(auth);
      return;
    }

    onState({ status: "allowed", user });
  });
}