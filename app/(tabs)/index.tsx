import { useEffect, useState, useCallback } from "react";
import { ScrollView, Text, View } from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "../../utils/firebase"; // adjust path
import { listPlayers, type Player } from "../../db/queries.firestore"; // adjust path
import { useFocusEffect } from "expo-router";

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      // Clear stale "permissions" errors when auth changes
      setError(null);
    });
    return () => unsub();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;

      let cancelled = false;

      (async () => {
        try {
          const data = await listPlayers();
          if (!cancelled) setPlayers(data);
        } catch (e: any) {
          console.error("Home listPlayers failed:", e);
          if (!cancelled) setError(e?.message ?? "Failed to load players");
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [uid])
  );

  if (error) return <Text>{error}</Text>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "700" }}>Player Stats</Text>

      <View style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 12, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", padding: 12, backgroundColor: "#f3f3f3" }}>
          <Text style={{ flex: 2, fontWeight: "700" }}>Player</Text>
          <Text style={{ flex: 1, fontWeight: "700", textAlign: "right" }}>Wins</Text>
          <Text style={{ flex: 1, fontWeight: "700", textAlign: "right" }}>Losses</Text>
        </View>

        {players.length === 0 ? (
          <View style={{ padding: 12 }}>
            <Text style={{ color: "#666" }}>No players yet. Save a game to create players.</Text>
          </View>
        ) : (
          players.map((p) => (
            <View
              key={p.id}
              style={{ flexDirection: "row", padding: 12, borderTopWidth: 1, borderTopColor: "#eee" }}
            >
              <Text style={{ flex: 2 }}>{p.name}</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>{p.wins}</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>{p.losses}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}