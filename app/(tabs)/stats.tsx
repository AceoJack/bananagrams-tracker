import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { listGames, type Game } from "../../db/queries.firestore";
import { formatDateTime, formatDuration } from "../../utils/format";

export default function StatsScreen() {
  const [games, setGames] = useState<Game[]>([]);

  const load = async () => {
    setGames(await listGames());
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "700" }}>Game History</Text>

      <View style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 12, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", padding: 12, backgroundColor: "#f3f3f3" }}>
          <Text style={{ flex: 2, fontWeight: "700" }}>Date</Text>
          <Text style={{ flex: 1.5, fontWeight: "700" }}>Winner</Text>
          <Text style={{ flex: 1, fontWeight: "700", textAlign: "right" }}>Time</Text>
        </View>

        {games.length === 0 ? (
          <View style={{ padding: 12 }}>
            <Text style={{ color: "#666" }}>No games yet. Use Split to record one.</Text>
          </View>
        ) : (
          games.map((g) => (
            <View
              key={g.id}
              style={{ flexDirection: "row", padding: 12, borderTopWidth: 1, borderTopColor: "#eee" }}
            >
              <Text style={{ flex: 2 }}>{formatDateTime(g.playedAt)}</Text>
              <Text style={{ flex: 1.5 }}>{g.winnerName}</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>{formatDuration(g.durationSeconds)}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}