import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { FadeInView } from "../../components/FadeInView";
import { listGames, type Game } from "../../db/queries.firestore";
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

  // 1. Longest word
  const longestEntry = allWords.reduce<{ word: string; winnerName: string } | null>(
    (best, w) => (!best || w.word.length > best.word.length ? w : best),
    null
  );

  // 2. Word length distribution
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

  // 3. Most common words (top 4)
  const wordFreq = new Map<string, number>();
  allWords.forEach(({ word }) => wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1));
  const topWords = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // 4. Most common letters (top 10)
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
        // For a full circle (single slice) use a simpler approach
        if (slices.length === 1) {
          const x1 = cx + r * Math.cos(s.start);
          const y1 = cy + r * Math.sin(s.start);
          const x2 = cx + r * Math.cos(s.end - 0.0001);
          const y2 = cy + r * Math.sin(s.end - 0.0001);
          return (
            <Path
              key={i}
              d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2} Z`}
              fill={s.color}
            />
          );
        }
        const x1 = cx + r * Math.cos(s.start);
        const y1 = cy + r * Math.sin(s.start);
        const x2 = cx + r * Math.cos(s.end);
        const y2 = cy + r * Math.sin(s.end);
        const large = s.sweep > Math.PI ? 1 : 0;
        return (
          <Path
            key={i}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
            fill={s.color}
          />
        );
      })}
    </Svg>
  );
}

// ── Stat card wrapper ─────────────────────────────────────────────────────────

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

// ── Screen ────────────────────────────────────────────────────────────────────

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

  useFocusEffect(useCallback(() => { load(); }, []));

  const { longestEntry, lengthData, topWords, topLetters, totalWords } = computeStats(games);
  const hasBoards = totalWords > 0;

  return (
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
          </ScrollView>
        </View>

        {/* ── Board stats section ── */}
        <Text style={{ fontSize: 20, fontWeight: "700", marginTop: 4 }}>Board Stats</Text>

        {!hasBoards ? (
          <View style={{ padding: 16, borderWidth: 1, borderColor: "#ddd", borderRadius: 12 }}>
            <Text style={{ color: "#666" }}>No board data yet. Scan a board when saving a game.</Text>
          </View>
        ) : (
          <>
            {/* Row 1: Longest word + Pie chart */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              {/* Longest word */}
              <View style={{ flex: 1 }}>
                <StatCard title="Longest Word">
                  {longestEntry ? (
                    <>
                      <Text style={{ fontSize: 28, fontWeight: "800", color: "#111", letterSpacing: 2 }}>
                        {longestEntry.word}
                      </Text>
                      <Text style={{ fontSize: 13, color: "#555" }}>
                        {longestEntry.word.length} letters
                      </Text>
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

              {/* Word length pie chart */}
              <View style={{ flex: 1 }}>
                <StatCard title="Word Lengths">
                  <View style={{ alignItems: "center" }}>
                    <PieChart data={lengthData} />
                  </View>
                  {/* Legend */}
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

            {/* Row 2: Most common word + Most common letters */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              {/* Most common words */}
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

              {/* Most common letters */}
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
                            height: 8,
                            borderRadius: 4,
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
  );
}
