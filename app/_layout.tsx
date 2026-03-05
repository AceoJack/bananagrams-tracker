import "react-native-get-random-values";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { getFirebaseAuth } from "../utils/firebase";
import { ensureSignedIn } from "../utils/auth";

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const auth = getFirebaseAuth();
      if (!auth.currentUser) await signInAnonymously(auth);
      setReady(true);
      const uid = await ensureSignedIn();
      console.log("Firebase UID:", uid);
    })();
  }, []);

  if (!ready) return null;

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}