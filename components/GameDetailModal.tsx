import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { Game } from "../db/queries.firestore";
import { formatDateTime, formatDuration } from "../utils/format";

const CELL = 38;

export function GameDetailModal({
  game,
  visible,
  onClose,
}: {
  game: Game | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!game) return null;

  const board = game.board;

  // Build cell lookup and grid dimensions
  const cellMap = new Map<string, string>(); // "col,row" -> letter
  let maxCol = 0, maxRow = 0;
  if (board) {
    for (const t of board.tiles) {
      cellMap.set(`${t.col},${t.row}`, t.letter);
      if (t.col > maxCol) maxCol = t.col;
      if (t.row > maxRow) maxRow = t.row;
    }
  }
  const gridCols = maxCol + 1;
  const gridRows = maxRow + 1;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#fff" }}>

        {/* Header */}
        <View style={{
          flexDirection: "row", justifyContent: "space-between", alignItems: "center",
          padding: 16, borderBottomWidth: 1, borderBottomColor: "#eee",
        }}>
          <View>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{formatDateTime(game.playedAt)}</Text>
            <Text style={{ fontSize: 13, color: "#666", marginTop: 2 }}>{formatDuration(game.durationSeconds)}</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "#ddd" }}
          >
            <Text style={{ color: "#444" }}>Close</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>

          {/* Players */}
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: "700" }}>Players</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {game.playerIds.map((id, i) => {
                const name = game.playerNames[i] ?? "Unknown";
                const isWinner = id === game.winnerId;
                return (
                  <View
                    key={id}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 4,
                      paddingHorizontal: 12, paddingVertical: 6,
                      borderRadius: 20, borderWidth: 1,
                      borderColor: isWinner ? "#F9A825" : "#ddd",
                      backgroundColor: isWinner ? "#FFF8E1" : "#fafafa",
                    }}
                  >
                    <Text style={{ fontWeight: isWinner ? "700" : "400", fontSize: 14 }}>{name}</Text>
                    {isWinner && <Text style={{ fontSize: 14 }}>🏆</Text>}
                  </View>
                );
              })}
            </View>
          </View>

          {/* Board */}
          {board ? (
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "700" }}>Board</Text>
              <ScrollView horizontal>
                <ScrollView>
                  {Array.from({ length: gridRows }, (_, row) => (
                    <View key={row} style={{ flexDirection: "row" }}>
                      {Array.from({ length: gridCols }, (_, col) => {
                        const letter = cellMap.get(`${col},${row}`);
                        return (
                          <View
                            key={col}
                            style={{
                              width: CELL, height: CELL,
                              margin: 1,
                              borderRadius: 4,
                              borderWidth: 1,
                              borderColor: letter ? "#F9A825" : "#ececec",
                              backgroundColor: letter ? "#FFF8E1" : "#fafafa",
                              justifyContent: "center",
                              alignItems: "center",
                            }}
                          >
                            {letter && (
                              <Text style={{ fontSize: 17, fontWeight: "700", color: "#222" }}>
                                {letter}
                              </Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </ScrollView>
              </ScrollView>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "700" }}>Board</Text>
              <Text style={{ color: "#999", fontStyle: "italic" }}>No board data recorded for this game.</Text>
            </View>
          )}

          {/* Words */}
          {board && board.words.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "700" }}>
                Words ({board.words.length})
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {board.words
                  .slice()
                  .sort((a, b) => b.word.length - a.word.length)
                  .map((w, i) => (
                    <View
                      key={i}
                      style={{
                        paddingHorizontal: 10, paddingVertical: 5,
                        borderRadius: 8, borderWidth: 1,
                        borderColor: w.direction === "horizontal" ? "#90CAF9" : "#CE93D8",
                        backgroundColor: w.direction === "horizontal" ? "#E3F2FD" : "#F3E5F5",
                      }}
                    >
                      <Text style={{ fontWeight: "700", fontFamily: "monospace", fontSize: 15 }}>
                        {w.word}
                      </Text>
                      <Text style={{ fontSize: 10, color: "#888", textAlign: "center" }}>
                        {w.direction === "horizontal" ? "→" : "↓"}
                      </Text>
                    </View>
                  ))}
              </View>
            </View>
          )}

        </ScrollView>
      </View>
    </Modal>
  );
}
