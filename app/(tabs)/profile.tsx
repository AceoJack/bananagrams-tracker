import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "../../utils/firebase";
import { logout } from "../../utils/auth.google";
import {
  getOrCreateUserProfile,
  updateUserProfile,
  type UserProfile,
} from "../../db/queries.firestore";
import { FadeInView } from "../../components/FadeInView";

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ photoURL, displayName, size = 72 }: { photoURL: string | null; displayName: string; size?: number }) {
  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#eee" }}
      />
    );
  }
  const initial = displayName.trim()[0]?.toUpperCase() ?? "?";
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: "#F9A825", alignItems: "center", justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size * 0.42, fontWeight: "700", color: "#fff" }}>{initial}</Text>
    </View>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: "#fff", borderRadius: 16,
      borderWidth: 1, borderColor: "#eee",
      shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 }, elevation: 2,
      padding: 16, gap: 12,
    }}>
      {children}
    </View>
  );
}

// ── Profile screen ────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Display name editing
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  const isMounted = useRef(true);
  useEffect(() => { return () => { isMounted.current = false; }; }, []);

  // Track auth user
  useEffect(() => {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (u) => {
      if (isMounted.current) setUser(u);
    });
  }, []);

  // Load profile when screen is focused and user is set
  useFocusEffect(
    useCallback(() => {
      if (!user) return;

      let cancelled = false;
      setLoading(true);
      setError(null);

      getOrCreateUserProfile({
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
      })
        .then((prof) => { if (!cancelled) { setProfile(prof); setLoading(false); } })
        .catch((e: any) => { if (!cancelled) { setError(e?.message ?? "Failed to load profile."); setLoading(false); } });

      return () => { cancelled = true; };
    }, [user])
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSaveName = async () => {
    if (!user || !profile) return;
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === profile.displayName) { setEditingName(false); return; }
    setSavingName(true);
    try {
      await updateUserProfile(user.uid, { displayName: trimmed });
      setProfile((p) => p ? { ...p, displayName: trimmed } : p);
      setEditingName(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save name.");
    } finally {
      setSavingName(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#FFFDE7" }}>
        <ActivityIndicator size="large" color="#F9A825" />
      </View>
    );
  }

  if (!profile || !user) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: "#c00" }}>{error ?? "Not signed in."}</Text>
      </View>
    );
  }

  return (
    <FadeInView>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 120 }}
        style={{ flex: 1, backgroundColor: "#FFFDE7" }}
      >
        {/* ── Header ── */}
        <View style={{ alignItems: "center", paddingVertical: 12, gap: 10 }}>
          <Avatar photoURL={profile.photoURL} displayName={profile.displayName} size={80} />
          <Text style={{ fontSize: 22, fontWeight: "800", color: "#1a1a1a" }}>
            {profile.displayName}
          </Text>
          {profile.email && (
            <Text style={{ fontSize: 13, color: "#888" }}>{profile.email}</Text>
          )}
        </View>

        {error && (
          <Text style={{ color: "#c00", fontSize: 13, textAlign: "center" }}>{error}</Text>
        )}

        {/* ── Display name ── */}
        <Card>
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Display Name
          </Text>
          {editingName ? (
            <View style={{ gap: 8 }}>
              <TextInput
                value={nameInput}
                onChangeText={setNameInput}
                autoFocus
                style={{
                  borderWidth: 1, borderColor: "#F9A825", borderRadius: 10,
                  padding: 10, fontSize: 16, backgroundColor: "#fffef8",
                }}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={handleSaveName}
                  disabled={savingName}
                  style={{ flex: 1, backgroundColor: "#111", borderRadius: 10, padding: 10, alignItems: "center" }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>
                    {savingName ? "Saving…" : "Save"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setEditingName(false)}
                  style={{ flex: 1, backgroundColor: "#f0f0f0", borderRadius: 10, padding: 10, alignItems: "center" }}
                >
                  <Text style={{ color: "#333", fontWeight: "600" }}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 17, color: "#1a1a1a" }}>{profile.displayName}</Text>
              <Pressable
                onPress={() => { setNameInput(profile.displayName); setEditingName(true); }}
                style={{ paddingHorizontal: 14, paddingVertical: 6, backgroundColor: "#f3f3f3", borderRadius: 8 }}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>Edit</Text>
              </Pressable>
            </View>
          )}
        </Card>

        {/* ── Legacy stats ── */}
        <Pressable
          onPress={() => router.push("/(tabs)/stats")}
          style={({ pressed }) => ({
            backgroundColor: pressed ? "#f0f0f0" : "#fff",
            borderRadius: 12, padding: 14,
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            borderWidth: 1, borderColor: "#e0e0e0",
          })}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: "#555" }}>Legacy Stats</Text>
          <Text style={{ fontSize: 16, color: "#bbb" }}>›</Text>
        </Pressable>

        {/* ── Sign out ── */}
        <Pressable
          onPress={logout}
          style={({ pressed }) => ({
            backgroundColor: pressed ? "#fee" : "#fff",
            borderRadius: 12, padding: 14, alignItems: "center",
            borderWidth: 1, borderColor: "#fcc",
          })}
        >
          <Text style={{ color: "#c00", fontWeight: "700", fontSize: 15 }}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </FadeInView>
  );
}
