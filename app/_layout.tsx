import { Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { subscribeAuthGate, signInWithGoogle, logout, type AuthGateState } from "../utils/auth.google";
import { getOrCreateUserProfile } from "../db/queries.firestore";

// ── Sign-in screen ────────────────────────────────────────────────────────────

function SignInScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setError("Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFDE7", justifyContent: "center", alignItems: "center", padding: 32, gap: 0 }}>
      {/* Logo / title */}
      <Text style={{ fontSize: 64, marginBottom: 8 }}>🍌</Text>
      <Text style={{ fontSize: 30, fontWeight: "800", color: "#1a1a1a", marginBottom: 6 }}>
        Bananagrams Tracker
      </Text>
      <Text style={{ fontSize: 15, color: "#777", textAlign: "center", marginBottom: 48 }}>
        Track scores, scan boards, and settle who the real Top Banana is.
      </Text>

      {/* Google sign-in button */}
      <Pressable
        onPress={handleSignIn}
        disabled={loading}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: pressed ? "#f0f0f0" : "#fff",
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 24,
          borderWidth: 1,
          borderColor: "#ddd",
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 3,
          opacity: loading ? 0.7 : 1,
        })}
      >
        {/* Google "G" mark */}
        <Text style={{ fontSize: 20, fontWeight: "700", color: "#4285F4" }}>G</Text>
        <Text style={{ fontSize: 16, fontWeight: "600", color: "#1a1a1a" }}>
          {loading ? "Signing in…" : "Sign in with Google"}
        </Text>
      </Pressable>

      {error && (
        <Text style={{ color: "#c00", fontSize: 13, marginTop: 16, textAlign: "center" }}>
          {error}
        </Text>
      )}
    </View>
  );
}

// ── Root layout ───────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [state, setState] = useState<AuthGateState>({ status: "loading" });
  const profileCreatedFor = useRef<string | null>(null);

  useEffect(() => {
    const unsub = subscribeAuthGate((s) => {
      setState(s);
      // Eagerly create/fetch profile once per uid — fire and forget
      if (s.status === "allowed" && profileCreatedFor.current !== s.user.uid) {
        profileCreatedFor.current = s.user.uid;
        getOrCreateUserProfile({
          uid: s.user.uid,
          displayName: s.user.displayName,
          email: s.user.email,
          photoURL: s.user.photoURL,
        }).catch(() => {/* non-critical, profile screen will retry */});
      }
    });
    return () => unsub();
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#30302E" } }} />

      {state.status !== "allowed" && (
        <View style={{ position: "absolute", inset: 0 }}>
          {state.status === "loading" ? (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#FFFDE7" }}>
              <Text style={{ fontSize: 48, marginBottom: 16 }}>🍌</Text>
              <ActivityIndicator size="large" color="#F9A825" />
            </View>
          ) : (
            <SignInScreen />
          )}
        </View>
      )}
    </>
  );
}
