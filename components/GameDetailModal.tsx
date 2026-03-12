import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { Game } from "../db/queries.firestore";
import { formatDateTime, formatDuration } from "../utils/format";
import { loadDictionary } from "../utils/dictionary";
import type { StoredBoardWord } from "./BoardEditorModal";

const CELL = 38;
const CELL_STEP = CELL + 2; // cell + margin*2

// ── Dictionary API types ──────────────────────────────────────────────────────

type DictEntry = {
  word: string;
  phonetic?: string;
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{ definition: string; example?: string }>;
  }>;
};

async function fetchDefinition(word: string): Promise<DictEntry[] | null> {
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GameDetailModal({
  game,
  visible,
  onClose,
}: {
  game: Game | null;
  visible: boolean;
  onClose: () => void;
}) {
  const [dict, setDict] = useState<Set<string> | null>(null);
  const [highlightedWord, setHighlightedWord] = useState<StoredBoardWord | null>(null);
  const [defWord, setDefWord] = useState<string | null>(null);
  const [defEntries, setDefEntries] = useState<DictEntry[] | null | "loading" | "none">(null);

  const hScrollRef = useRef<ScrollView>(null);
  const vScrollRef = useRef<ScrollView>(null);
  const gridViewport = useRef({ width: 0, height: 0 });

  // Load dictionary when modal opens
  useEffect(() => {
    if (!visible) {
      setHighlightedWord(null);
      setDefWord(null);
      setDefEntries(null);
      return;
    }
    if (!dict) {
      loadDictionary().then(setDict).catch((e) => console.warn("[Dict]", e));
    }
  }, [visible]);

  // Scroll grid to centre the highlighted word
  useEffect(() => {
    if (!highlightedWord) return;
    const wordCols = highlightedWord.direction === "horizontal" ? highlightedWord.word.length : 1;
    const wordRows = highlightedWord.direction === "vertical"   ? highlightedWord.word.length : 1;
    const midX = 8 + highlightedWord.startCol * CELL_STEP + (wordCols * CELL_STEP) / 2;
    const midY = 8 + highlightedWord.startRow * CELL_STEP + (wordRows * CELL_STEP) / 2;
    hScrollRef.current?.scrollTo({ x: Math.max(0, midX - gridViewport.current.width  / 2), animated: true });
    vScrollRef.current?.scrollTo({ y: Math.max(0, midY - gridViewport.current.height / 2), animated: true });
  }, [highlightedWord]);

  if (!game) return null;

  const board = game.board;

  // Build cell lookup and grid dimensions
  const cellMap = new Map<string, string>();
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

  // Highlighted cell keys
  const highlightedCells = useMemo((): Set<string> => {
    if (!highlightedWord) return new Set();
    const keys = new Set<string>();
    for (let i = 0; i < highlightedWord.word.length; i++) {
      const col = highlightedWord.direction === "horizontal" ? highlightedWord.startCol + i : highlightedWord.startCol;
      const row = highlightedWord.direction === "vertical"   ? highlightedWord.startRow + i : highlightedWord.startRow;
      keys.add(`${col},${row}`);
    }
    return keys;
  }, [highlightedWord]);

  // Sorted words: invalid first, then valid, each group longest first
  const sortedWords = useMemo(() => {
    if (!board) return [];
    const words = board.words.slice();
    if (!dict) return words.sort((a, b) => b.word.length - a.word.length);
    const invalid = words.filter((w) => !dict.has(w.word.toUpperCase())).sort((a, b) => b.word.length - a.word.length);
    const valid   = words.filter((w) =>  dict.has(w.word.toUpperCase())).sort((a, b) => b.word.length - a.word.length);
    return [...invalid, ...valid];
  }, [board, dict]);

  // Tap a word chip: highlight on grid + fetch definition
  const handleWordTap = async (w: StoredBoardWord) => {
    const isActive =
      highlightedWord?.word === w.word &&
      highlightedWord?.startCol === w.startCol &&
      highlightedWord?.startRow === w.startRow;

    if (isActive) {
      setHighlightedWord(null);
      setDefWord(null);
      setDefEntries(null);
      return;
    }

    setHighlightedWord(w);
    setDefWord(w.word);
    setDefEntries("loading");
    const entries = await fetchDefinition(w.word);
    setDefEntries(entries && entries.length > 0 ? entries : "none");
  };

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
              <ScrollView
                ref={hScrollRef}
                horizontal
                style={{ maxHeight: 340 }}
                onLayout={(e) => {
                  gridViewport.current.width  = e.nativeEvent.layout.width;
                  gridViewport.current.height = e.nativeEvent.layout.height;
                }}
              >
                <ScrollView ref={vScrollRef}>
                  {Array.from({ length: gridRows }, (_, row) => (
                    <View key={row} style={{ flexDirection: "row" }}>
                      {Array.from({ length: gridCols }, (_, col) => {
                        const letter = cellMap.get(`${col},${row}`);
                        const isHighlighted = highlightedCells.has(`${col},${row}`);
                        return (
                          <View
                            key={col}
                            style={{
                              width: CELL, height: CELL,
                              margin: 1,
                              borderRadius: 4,
                              borderWidth: isHighlighted ? 2 : 1,
                              borderColor: isHighlighted ? "#7B1FA2" : letter ? "#F9A825" : "#ececec",
                              backgroundColor: isHighlighted ? "#EDE7F6" : letter ? "#FFF8E1" : "#fafafa",
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
          {board && sortedWords.length > 0 && (
            <View style={{ gap: 10 }}>
              <Text style={{ fontSize: 15, fontWeight: "700" }}>
                Words ({sortedWords.length}){dict === null ? " — checking…" : ""}
              </Text>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {sortedWords.map((w, i) => {
                  const valid = dict === null ? true : dict.has(w.word.toUpperCase());
                  const isActive =
                    highlightedWord?.word === w.word &&
                    highlightedWord?.startCol === w.startCol &&
                    highlightedWord?.startRow === w.startRow;

                  const chipBg = !valid
                    ? "#FFEBEE"
                    : isActive
                    ? "#EDE7F6"
                    : w.direction === "horizontal" ? "#E3F2FD" : "#F3E5F5";

                  const chipBorder = !valid
                    ? "#EF9A9A"
                    : isActive
                    ? "#7B1FA2"
                    : w.direction === "horizontal" ? "#90CAF9" : "#CE93D8";

                  return (
                    <Pressable
                      key={i}
                      onPress={() => handleWordTap(w)}
                      style={{
                        paddingHorizontal: 10, paddingVertical: 5,
                        borderRadius: 8, borderWidth: isActive ? 2 : 1,
                        borderColor: chipBorder,
                        backgroundColor: chipBg,
                      }}
                    >
                      <Text style={{ fontWeight: "700", fontFamily: "monospace", fontSize: 15, color: !valid ? "#C62828" : "#222" }}>
                        {w.word}
                      </Text>
                      <Text style={{ fontSize: 10, color: !valid ? "#EF5350" : "#888", textAlign: "center" }}>
                        {!valid ? "invalid" : w.direction === "horizontal" ? "→" : "↓"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Definition box */}
              {defWord && (
                <View style={{
                  borderRadius: 10, borderWidth: 1, borderColor: "#e0e0e0",
                  backgroundColor: "#fafafa", padding: 14, gap: 10,
                }}>
                  {defEntries === "loading" && (
                    <Text style={{ color: "#999", fontStyle: "italic" }}>Looking up "{defWord}"…</Text>
                  )}

                  {defEntries === "none" && (
                    <Text style={{ color: "#888" }}>
                      No definition found for <Text style={{ fontWeight: "700" }}>"{defWord}"</Text>.
                    </Text>
                  )}

                  {Array.isArray(defEntries) && (
                    <>
                      {/* Word + phonetic */}
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                        <Text style={{ fontSize: 18, fontWeight: "800", color: "#111" }}>
                          {defEntries[0].word.toUpperCase()}
                        </Text>
                        {defEntries[0].phonetic && (
                          <Text style={{ fontSize: 13, color: "#888" }}>{defEntries[0].phonetic}</Text>
                        )}
                      </View>

                      {/* Meanings — show first definition per part-of-speech, up to 3 */}
                      <View style={{ gap: 8 }}>
                        {defEntries
                          .flatMap((e) => e.meanings)
                          .reduce<typeof defEntries[0]["meanings"]>((acc, m) => {
                            if (!acc.find((x) => x.partOfSpeech === m.partOfSpeech)) acc.push(m);
                            return acc;
                          }, [])
                          .slice(0, 3)
                          .map((meaning, mi) => (
                            <View key={mi} style={{ gap: 3 }}>
                              <Text style={{ fontSize: 11, fontWeight: "700", color: "#7B1FA2", textTransform: "uppercase", letterSpacing: 0.5 }}>
                                {meaning.partOfSpeech}
                              </Text>
                              <Text style={{ fontSize: 14, color: "#333", lineHeight: 20 }}>
                                {meaning.definitions[0]?.definition}
                              </Text>
                              {meaning.definitions[0]?.example && (
                                <Text style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}>
                                  "{meaning.definitions[0].example}"
                                </Text>
                              )}
                            </View>
                          ))}
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          )}

        </ScrollView>
      </View>
    </Modal>
  );
}
