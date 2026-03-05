import React, { useEffect, useState } from "react";
import { listPlayers, type Player } from "../../db/queries.firestore";
import { Platform, ScrollView, Text, View } from "react-native";

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // prevents server-render path from running Firebase logic
    if (Platform.OS === "web" && typeof window === "undefined") return;

    (async () => {
      try {
        const data = await listPlayers();
        setPlayers(data);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load players");
      }
    })();
  }, []);

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