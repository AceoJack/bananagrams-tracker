import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { subscribeAuthGate, signInWithGoogle, type AuthGateState } from "../utils/auth.google";

export default function RootLayout() {
  const [state, setState] = useState<AuthGateState>({ status: "loading" });

  useEffect(() => {
    const unsub = subscribeAuthGate(setState);
    return () => unsub();
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />

      {state.status !== "allowed" && (
        <View
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "white",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
            gap: 12,
          }}
        >
          {state.status === "loading" && <Text>Loading…</Text>}

          {state.status === "signedOut" && (
            <>
              <Text style={{ fontSize: 20, fontWeight: "700" }}>Bananagrams Tracker</Text>
              <Pressable onPress={signInWithGoogle} style={{ padding: 12, backgroundColor: "#111", borderRadius: 10 }}>
                <Text style={{ color: "white" }}>Sign in with Google</Text>
              </Pressable>
            </>
          )}

          {state.status === "notAllowed" && (
            <>
              <Text style={{ fontSize: 18, fontWeight: "700" }}>Access not granted</Text>
              <Text selectable>Email: {state.email}</Text>
              <Text selectable>UID: {state.uid}</Text>
              <Text>Ask the admin to allowlist you.</Text>
              <Pressable onPress={signInWithGoogle} style={{ padding: 12, backgroundColor: "#111", borderRadius: 10 }}>
                <Text style={{ color: "white" }}>Try another Google account</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </>
  );
}