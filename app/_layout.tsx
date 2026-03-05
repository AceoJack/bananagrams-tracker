import "react-native-get-random-values";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View, Pressable } from "react-native";
import { signInAnonymously } from "firebase/auth";
import { getFirebaseAuth } from "../utils/firebase";
import { ensureSignedIn } from "../utils/auth";
import {
  completeRedirectIfNeeded,
  signInWithGoogle,
  subscribeAuthGate,
  type AuthGateState,
} from "../utils/auth.google";

export default function RootLayout() {
  const [state, setState] = useState<AuthGateState>({ status: "loading" });

  useEffect(() => {
    (async () => {
      await completeRedirectIfNeeded();
      const unsub = subscribeAuthGate(setState);
      return () => unsub();
    })();
  }, []);

  if (state.status === "loading") {
    return <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}><Text>Loading…</Text></View>;
  }

  if (state.status === "signedOut") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20, gap: 12 }}>
        <Text style={{ fontSize: 20, fontWeight: "700" }}>Bananagrams Tracker</Text>
        <Pressable onPress={signInWithGoogle} style={{ padding: 12, backgroundColor: "#111", borderRadius: 10 }}>
          <Text style={{ color: "white" }}>Sign in with Google</Text>
        </Pressable>
      </View>
    );
  }

  if (state.status === "notAllowed") {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 20, gap: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Access not granted</Text>
        <Text>This app is private.</Text>
        <Text>Send this to the admin:</Text>
        <Text selectable>Email: {state.email}</Text>
        <Text selectable>UID: {state.uid}</Text>
        <Pressable onPress={signInWithGoogle} style={{ marginTop: 12, padding: 12, backgroundColor: "#111", borderRadius: 10 }}>
          <Text style={{ color: "white" }}>Try another Google account</Text>
        </Pressable>
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}