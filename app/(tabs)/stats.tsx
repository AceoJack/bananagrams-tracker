import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { FadeInView } from "../../components/FadeInView";
import { listGames, deleteGame, type Game } from "../../db/queries.firestore";
import { GameDetailModal } from "../../components/GameDetailModal";
import { formatDateTime, formatDuration } from "../../utils/format";

// ── Colours ───────────────────────────────────────────────────────────────────

const PIE_COLORS = [
  "#FFED29", "#4CAF50", "#2196F3", "#FF5722", "#9C27B0",
  "#00BCD4", "#FF9800", "#E91E63", "#607D8B", "#795548",
  "#8BC34A", "#F44336",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeStats(games: Game[]) {
  const allWords: { word: string; winnerName: string }[] = [];
  games.forEach((g) => {
    (g.board?.words ?? []).forEach((w) => {
      allWords.push({ word: w.word.toUpperCase(), winnerName: g.winnerName });
    });
  });

  const longestEntry = allWords.reduce<{ word: string; winnerName: string } | null>(
    (best, w) => (!best || w.word.length > best.word.length ? w : best),
    null
  );

  const lengthFreq = new Map<number, number>();
  allWords.forEach(({ word }) => {
    lengthFreq.set(word.length, (lengthFreq.get(word.length) ?? 0) + 1);
  });
  const lengthData = Array.from(lengthFreq.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([len, count], i) => ({
      label: `${len}`,
      value: count,
      color: PIE_COLORS[i % PIE_COLORS.length],
    }));

  const wordFreq = new Map<string, number>();
  allWords.forEach(({ word }) => wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1));
  const topWords = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const letterFreq = new Map<string, number>();
  allWords.forEach(({ word }) => {
    word.split("").forEach((ch) => letterFreq.set(ch, (letterFreq.get(ch) ?? 0) + 1));
  });
  const topLetters = Array.from(letterFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return { longestEntry, lengthData, topWords, topLetters, totalWords: allWords.length };
}

// ── Pie chart ─────────────────────────────────────────────────────────────────

function PieChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const size = 130;
  const cx = size / 2;
  const cy = size / 2;
  const r = 52;

  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  let angle = -Math.PI / 2;
  const slices = data.map((d) => {
    const sweep = (d.value / total) * 2 * Math.PI;
    const start = angle;
    angle += sweep;
    return { ...d, start, end: angle, sweep };
  });

  return (
    <Svg width={size} height={size}>
      {slices.map((s, i) => {
        if (slices.length === 1) {
          const x1 = cx + r * Math.cos(s.start);
          const y1 = cy + r * Math.sin(s.start);
          const x2 = cx + r * Math.cos(s.end - 0.0001);
          const y2 = cy + r * Math.sin(s.end - 0.0001);
          return (
            <Path key={i} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2} Z`} fill={s.color} />
          );
        }
        const x1 = cx + r * Math.cos(s.start);
        const y1 = cy + r * Math.sin(s.start);
        const x2 = cx + r * Math.cos(s.end);
        const y2 = cy + r * Math.sin(s.end);
        const large = s.sweep > Math.PI ? 1 : 0;
        return (
          <Path key={i} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={s.color} />
        );
      })}
    </Svg>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{
      borderWidth: 1, borderColor: "#ddd", borderRadius: 12,
      padding: 14, backgroundColor: "#fff",
      shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
      gap: 10,
    }}>
      <Text style={{ fontSize: 14, fontWeight: "700", color: "#333", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

// ── Swipeable game row ────────────────────────────────────────────────────────

function GameRow({
  game,
  onPress,
  onDelete,
}: {
  game: Game;
  onPress: () => void;
  onDelete: () => void;
}) {
  const swipeRef = useRef<Swipeable>(null);

  const confirmDelete = () => {
    swipeRef.current?.close();
    if (Platform.OS === "web") {
      if (window.confirm(`Delete the game played on ${formatDateTime(game.playedAt)}?\n\nThis will reverse the win/loss counts for all players.`)) {
        onDelete();
      }
    } else {
      Alert.alert(
        "Delete Game",
        `Delete the game played on ${formatDateTime(game.playedAt)}? This will also reverse the win/loss counts for all players.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: onDelete },
        ]
      );
    }
  };

  const renderRightActions = () => (
    <Pressable
      onPress={confirmDelete}
      style={{
        backgroundColor: "#C62828",
        justifyContent: "center",
        alignItems: "center",
        width: 72,
        borderTopRightRadius: 0,
        borderBottomRightRadius: 0,
      }}
    >
      <Text style={{ fontSize: 22 }}>🗑️</Text>
      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600", marginTop: 2 }}>Delete</Text>
    </Pressable>
  );

  return (
    <Swipeable ref={swipeRef} renderRightActions={renderRightActions} rightThreshold={40} overshootRight={false}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row",
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: "#eee",
          backgroundColor: pressed ? "#f9f9f9" : "white",
        })}
      >
        <Text style={{ flex: 2 }}>{formatDateTime(game.playedAt)}</Text>
        <Text style={{ flex: 1.5 }}>{game.winnerName}</Text>
        <Text style={{ flex: 1, textAlign: "right" }}>{formatDuration(game.durationSeconds)}</Text>
      </Pressable>
    </Swipeable>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function StatsScreen() {
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    try {
      setGames(await listGames());
      setError(null);
    } catch (e: any) {
      console.error("listGames failed:", e);
      setError(e?.message ?? "Failed to load games");
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const handleDelete = async (game: Game) => {
    setDeletingId(game.id);
    try {
      await deleteGame(game);
      setGames((prev) => prev.filter((g) => g.id !== game.id));
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to delete game.");
    } finally {
      setDeletingId(null);
    }
  };

  const { longestEntry, lengthData, topWords, topLetters, totalWords } = computeStats(games);
  const hasBoards = totalWords > 0;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <FadeInView>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 100 }}>
          <Text style={{ fontSize: 24, fontWeight: "700" }}>Game History</Text>

          {/* ── Fixed-height scrollable game list ── */}
          <View style={{ height: 240, borderWidth: 1, borderColor: "#ddd", borderRadius: 12, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", padding: 12, backgroundColor: "#f3f3f3" }}>
              <Text style={{ flex: 2, fontWeight: "700" }}>Date</Text>
              <Text style={{ flex: 1.5, fontWeight: "700" }}>Winner</Text>
              <Text style={{ flex: 1, fontWeight: "700", textAlign: "right" }}>Time</Text>
            </View>

            <ScrollView style={{ flex: 1 }}>
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
                  <View key={g.id} style={{ opacity: deletingId === g.id ? 0.4 : 1 }}>
                    <GameRow
                      game={g}
                      onPress={() => setSelectedGame(g)}
                      onDelete={() => handleDelete(g)}
                    />
                  </View>
                ))
              )}
            </ScrollView>
          </View>

          {/* ── Board stats ── */}
          <Text style={{ fontSize: 20, fontWeight: "700", marginTop: 4 }}>Board Stats</Text>

          {!hasBoards ? (
            <View style={{ padding: 16, borderWidth: 1, borderColor: "#ddd", borderRadius: 12 }}>
              <Text style={{ color: "#666" }}>No board data yet. Scan a board when saving a game.</Text>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <StatCard title="Longest Word">
                    {longestEntry ? (
                      <>
                        <Text style={{ fontSize: 28, fontWeight: "800", color: "#111", letterSpacing: 2 }}>
                          {longestEntry.word}
                        </Text>
                        <Text style={{ fontSize: 13, color: "#555" }}>{longestEntry.word.length} letters</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFED29", borderWidth: 1, borderColor: "#ccc" }} />
                          <Text style={{ fontSize: 13, color: "#555" }}>by {longestEntry.winnerName}</Text>
                        </View>
                      </>
                    ) : (
                      <Text style={{ color: "#999" }}>—</Text>
                    )}
                  </StatCard>
                </View>

                <View style={{ flex: 1 }}>
                  <StatCard title="Word Lengths">
                    <View style={{ alignItems: "center" }}>
                      <PieChart data={lengthData} />
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {lengthData.map((d) => (
                        <View key={d.label} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: d.color }} />
                          <Text style={{ fontSize: 11, color: "#555" }}>{d.label}L ({d.value})</Text>
                        </View>
                      ))}
                    </View>
                  </StatCard>
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <StatCard title="Most Common Words">
                    {topWords.length === 0 ? (
                      <Text style={{ color: "#999" }}>—</Text>
                    ) : (
                      topWords.map(([word, count], i) => (
                        <View key={word} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <View style={{
                            width: 22, height: 22, borderRadius: 11,
                            backgroundColor: i === 0 ? "#FFED29" : "#f0f0f0",
                            alignItems: "center", justifyContent: "center",
                          }}>
                            <Text style={{ fontSize: 11, fontWeight: "700", color: "#333" }}>{i + 1}</Text>
                          </View>
                          <Text style={{ flex: 1, fontSize: i === 0 ? 16 : 14, fontWeight: i === 0 ? "700" : "400", color: "#111" }}>
                            {word}
                          </Text>
                          <Text style={{ fontSize: 12, color: "#888" }}>×{count}</Text>
                        </View>
                      ))
                    )}
                  </StatCard>
                </View>

                <View style={{ flex: 1 }}>
                  <StatCard title="Top 10 Letters">
                    {topLetters.length === 0 ? (
                      <Text style={{ color: "#999" }}>—</Text>
                    ) : (() => {
                      const maxCount = topLetters[0][1];
                      return topLetters.map(([letter, count], i) => (
                        <View key={letter} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ width: 18, fontSize: 13, fontWeight: "700", color: "#111" }}>{letter}</Text>
                          <View style={{ flex: 1, height: 8, backgroundColor: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
                            <View style={{
                              width: `${(count / maxCount) * 100}%` as any,
                              height: 8, borderRadius: 4,
                              backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                            }} />
                          </View>
                          <Text style={{ width: 28, fontSize: 11, color: "#888", textAlign: "right" }}>{count}</Text>
                        </View>
                      ));
                    })()}
                  </StatCard>
                </View>
              </View>
            </>
          )}
        </ScrollView>

        <GameDetailModal
          game={selectedGame}
          visible={selectedGame !== null}
          onClose={() => setSelectedGame(null)}
        />
      </FadeInView>
    </GestureHandlerRootView>
  );
}
