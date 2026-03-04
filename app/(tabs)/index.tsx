import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { listPlayers, type PlayerRow } from "../../db/queries";

export default function HomeScreen() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);

  const load = async () => {
    setPlayers(await listPlayers());
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

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