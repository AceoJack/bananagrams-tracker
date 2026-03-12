import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { FadeInView } from "../../components/FadeInView";
import { listGames, type Game } from "../../db/queries.firestore";
import { GameDetailModal } from "../../components/GameDetailModal";
import { formatDateTime, formatDuration } from "../../utils/format";

export default function StatsScreen() {
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setGames(await listGames());
      setError(null);
    } catch (e: any) {
      console.error("listGames failed:", e);
      setError(e?.message ?? "Failed to load games");
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  return (
    <FadeInView>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: "700" }}>Game History</Text>

        <View style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 12, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", padding: 12, backgroundColor: "#f3f3f3" }}>
            <Text style={{ flex: 2, fontWeight: "700" }}>Date</Text>
            <Text style={{ flex: 1.5, fontWeight: "700" }}>Winner</Text>
            <Text style={{ flex: 1, fontWeight: "700", textAlign: "right" }}>Time</Text>
          </View>

          {error ? (
            <View style={{ padding: 12 }}>
              <Text style={{ color: "#c00" }}>{error}</Text>
            </View>
          ) : games.length === 0 ? (
            <View style={{ padding: 12 }}>
              <Text style={{ color: "#666" }}>No games yet. Use Split to record one.</Text>
            </View>
          ) : (
            games.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => setSelectedGame(g)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  padding: 12,
                  borderTopWidth: 1,
                  borderTopColor: "#eee",
                  backgroundColor: pressed ? "#f9f9f9" : "white",
                })}
              >
                <Text style={{ flex: 2 }}>{formatDateTime(g.playedAt)}</Text>
                <Text style={{ flex: 1.5 }}>{g.winnerName}</Text>
                <Text style={{ flex: 1, textAlign: "right" }}>{formatDuration(g.durationSeconds)}</Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>

      <GameDetailModal
        game={selectedGame}
        visible={selectedGame !== null}
        onClose={() => setSelectedGame(null)}
      />
    </FadeInView>
  );
}
