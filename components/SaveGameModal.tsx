import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Audio } from "expo-av";
import type { Player, StoredBoard } from "../db/queries.firestore";
import { createGame, createPlayer, listPlayers } from "../db/queries.firestore";
import type { OCRResult } from "../utils/ocr";
import { runOCR } from "../utils/ocr";
import { AddPlayerSheet } from "./AddPlayerSheet";
import { initGrid, deriveWordsFromGrid } from "./BoardEditorModal";
import type { BoardCell, CellKey, CellState, StoredBoardWord } from "./BoardEditorModal";
import { loadDictionary } from "../utils/dictionary";
import { PlayerMultiSelect } from "./PlayerMultiSelect";
import * as Haptics from "expo-haptics";

// ── Celebration overlay ───────────────────────────────────────────────────────

function CelebrationOverlay({ type, onDone }: { type: "bananas" | "rotten"; onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    // Animate in
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 180 }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    // Play sound
    let soundObj: Audio.Sound | null = null;
    (async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          isBananas
            ? require("../assets/sounds/bananas.mp3")
            : require("../assets/sounds/rotten-bananas.mp3")
        );
        soundObj = sound;
        await sound.playAsync();
      } catch (e) {
        // Sound is optional — silently ignore errors
      }
    })();

    // Fire confetti on web for valid boards
    if (type === "bananas" && Platform.OS === "web") {
      import("canvas-confetti").then(({ default: confetti }) => {
        const burst = (x: number, angle: number) =>
          confetti({ particleCount: 70, spread: 60, origin: { x, y: 1 }, angle, startVelocity: 55,
            colors: ["#FFD700", "#FFA500", "#FFEC47", "#FFF176", "#FF8F00", "#ffffff"] });
        burst(0.2, 70);
        setTimeout(() => burst(0.8, 110), 150);
        setTimeout(() => burst(0.5, 90), 300);
      });
    }

    // Auto-dismiss after 2.8 s
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(onDone);
    }, 2800);

    return () => {
      clearTimeout(timer);
      soundObj?.unloadAsync();
    };
  }, []);

  const isBananas = type === "bananas";

  return (
    <Modal visible transparent animationType="none" onRequestClose={onDone}>
      <Pressable
        style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.45)" }}
        onPress={() => Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(onDone)}
      >
        <Animated.View style={{ opacity, transform: [{ scale }], alignItems: "center" }}>
          {isBananas ? (
            <Text style={{ fontSize: 64, marginBottom: 8 }}>🍌</Text>
          ) : (
            <Image
              source={require("../assets/images/rotten-bananas.png")}
              style={{ width: 80, height: 80, marginBottom: 8 }}
              resizeMode="contain"
            />
          )}
          <View style={{
            paddingHorizontal: 36, paddingVertical: 20, borderRadius: 20,
            backgroundColor: isBananas ? "#FFF8E1" : "#EFEBE9",
            borderWidth: 2, borderColor: isBananas ? "#F9A825" : "#795548",
            shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 }, elevation: 8,
            alignItems: "center",
          }}>
            <Text style={{ fontSize: 32, fontWeight: "800", color: isBananas ? "#E65100" : "#4E342E", letterSpacing: 0.5 }}>
              {isBananas ? "Bananas!" : "Rotten Bananas!"}
            </Text>
            <Text style={{ fontSize: 13, color: isBananas ? "#F57F17" : "#6D4C41", marginTop: 6 }}>
              {isBananas ? "All words are valid — nice board!" : "Some words aren't in the dictionary."}
            </Text>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const CELL = 44;
const KEY_GAP = 4;
const KEYBOARD_ROWS = [
  "QWERTYUIOP".split(""),
  "ASDFGHJKL".split(""),
  "ZXCVBNM".split(""),
];

const STEP_LABELS = ["Scan Board", "Edit Board", "Players"];

export function SaveGameModal({
  visible,
  onClose,
  durationSeconds,
  playedAtISO,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  durationSeconds: number;
  playedAtISO: string;
  onSaved: () => Promise<void> | void;
}) {
  // ── Responsive keyboard sizing ───────────────────────────────────────────────
  // Modal outer padding is 20px each side; keyboard section has paddingHorizontal 12px each side.
  // Row 0 (QWERTYUIOP) has 10 keys + 9 gaps — this is the widest row.
  const { width: windowWidth } = useWindowDimensions();
  const kbAvailableWidth = windowWidth - 40 - 24; // 40 = modal padding×2, 24 = kb padding×2
  const KEY_SIZE = Math.min(34, Math.floor((kbAvailableWidth - 9 * KEY_GAP) / 10));
  const ROW_OFFSETS = [0, (KEY_SIZE + KEY_GAP) * 0.5, (KEY_SIZE + KEY_GAP) * 1.25];

  // ── Step ─────────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ── Step 1: OCR ──────────────────────────────────────────────────────────────
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<{ identified: number; detected: number } | null>(null);
  const [showTileDebug, setShowTileDebug] = useState(false);

  // ── Step 2: Board editor ─────────────────────────────────────────────────────
  const [editorCells, setEditorCells] = useState<Map<CellKey, CellState>>(new Map());
  const [gridCols, setGridCols] = useState(3);
  const [gridRows, setGridRows] = useState(3);
  const [selecting, setSelecting] = useState<{ col: number; row: number } | null>(null);
  const [dict, setDict] = useState<Set<string> | null>(null);
  const [highlightedWord, setHighlightedWord] = useState<StoredBoardWord | null>(null);
  const hScrollRef = useRef<ScrollView>(null);
  const vScrollRef = useRef<ScrollView>(null);
  const gridViewport = useRef({ width: 0, height: 0 });

  // ── Step 3: Players/winner ───────────────────────────────────────────────────
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [winnerId, setWinnerId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  // ── Shared ───────────────────────────────────────────────────────────────────
  const [savedBoard, setSavedBoard] = useState<StoredBoard | null>(null);
  const [celebration, setCelebration] = useState<"bananas" | "rotten" | null>(null);

  const objectUrls = useRef<string[]>([]);
  const track = (url: string) => { objectUrls.current.push(url); return url; };
  const revokeAll = () => {
    objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.current = [];
  };

  useEffect(() => {
    if (visible) {
      setStep(1);
      refreshPlayers();
      setSelectedIds([]);
      setWinnerId("");
    } else {
      revokeAll();
      setPreviewUrl(null);
      setOcrResult(null);
      setOcrProgress(null);
      setSavedBoard(null);
      setSelecting(null);
    }
  }, [visible]);

  const refreshPlayers = async () => setPlayers(await listPlayers());

  // ── OCR ──────────────────────────────────────────────────────────────────────

  const handleChoosePhoto = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      revokeAll();
      setOcrResult(null);
      setSavedBoard(null); // clear saved board so step 2 reinits from fresh scan
      setShowTileDebug(false);
      setOcrProgress(null);
      setPreviewUrl(track(URL.createObjectURL(file)));
      setOcrRunning(true);

      try {
        const result = await runOCR(file, (identified, detected) =>
          setOcrProgress({ identified, detected })
        );
        track(result.debugImageUrl);
        result.tiles.forEach((t) => track(t.debugUrl));
        setOcrResult(result);
      } catch (e) {
        console.error("[OCR] failed:", e);
        Alert.alert("OCR failed", String(e));
      } finally {
        setOcrRunning(false);
      }
    };

    input.click();
  };

  // ── Board editor helpers ─────────────────────────────────────────────────────

  function initEditorFromOCR() {
    if (!ocrResult) {
      setEditorCells(new Map());
      setGridCols(3);
      setGridRows(3);
    } else {
      const { cells, cols, rows } = initGrid(ocrResult.tiles, ocrResult.words);
      setEditorCells(cells);
      setGridCols(cols);
      setGridRows(rows);
    }
    setSelecting(null);
  }

  function initEditorFromSavedBoard(board: StoredBoard) {
    const c = new Map<CellKey, CellState>();
    for (const cell of board.tiles) {
      c.set(`${cell.col},${cell.row}`, { letter: cell.letter, source: "ocr" });
    }
    const allCols = board.tiles.map((cell) => cell.col);
    const allRows = board.tiles.map((cell) => cell.row);
    setEditorCells(c);
    setGridCols(board.tiles.length > 0 ? Math.max(...allCols) + 2 : 3);
    setGridRows(board.tiles.length > 0 ? Math.max(...allRows) + 2 : 3);
    setSelecting(null);
  }

  function handleCellPress(col: number, row: number) {
    setHighlightedWord(null);
    setSelecting((prev) =>
      prev?.col === col && prev?.row === row ? null : { col, row }
    );
  }

  function handleLetterSelect(letter: string) {
    if (!selecting) return;
    const { col, row } = selecting;
    const onLeft = col === 0;
    const onRight = col === gridCols - 1;
    const onTop = row === 0;
    const onBottom = row === gridRows - 1;

    setEditorCells((prev) => {
      const next = new Map<CellKey, CellState>();
      for (const [k, v] of prev) {
        let [c, r] = k.split(",").map(Number);
        if (onLeft) c += 1;
        if (onTop) r += 1;
        next.set(`${c},${r}`, v);
      }
      next.set(`${onLeft ? col + 1 : col},${onTop ? row + 1 : row}`, {
        letter,
        source: "manual",
      });
      return next;
    });

    if (onLeft || onRight) setGridCols((c) => c + 1);
    if (onTop || onBottom) setGridRows((r) => r + 1);
    setSelecting(null);
  }

  function handleClearCell() {
    if (!selecting) return;
    const key = `${selecting.col},${selecting.row}`;
    setEditorCells((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setSelecting(null);
  }

  // ── Live words (step 2) ──────────────────────────────────────────────────────
  const liveWords = useMemo(() => deriveWordsFromGrid(editorCells), [editorCells]);

  const sortedWords = useMemo(() => {
    if (!dict) return liveWords.slice().sort((a, b) => b.word.length - a.word.length);
    const invalid = liveWords.filter((w) => !dict.has(w.word.toUpperCase())).sort((a, b) => b.word.length - a.word.length);
    const valid = liveWords.filter((w) => dict.has(w.word.toUpperCase())).sort((a, b) => b.word.length - a.word.length);
    return [...invalid, ...valid];
  }, [liveWords, dict]);

  // Scroll grid to centre the highlighted word whenever it changes
  useEffect(() => {
    if (!highlightedWord) return;
    const CELL_STEP = CELL + 2; // cell (44) + margin*2 (1 each side)
    const GRID_PAD = 8;

    const wordCols = highlightedWord.direction === "horizontal" ? highlightedWord.word.length : 1;
    const wordRows = highlightedWord.direction === "vertical"   ? highlightedWord.word.length : 1;

    const wordMidX = GRID_PAD + highlightedWord.startCol * CELL_STEP + (wordCols * CELL_STEP) / 2;
    const wordMidY = GRID_PAD + highlightedWord.startRow * CELL_STEP + (wordRows * CELL_STEP) / 2;

    const scrollX = Math.max(0, wordMidX - gridViewport.current.width  / 2);
    const scrollY = Math.max(0, wordMidY - gridViewport.current.height / 2);

    hScrollRef.current?.scrollTo({ x: scrollX, animated: true });
    vScrollRef.current?.scrollTo({ y: scrollY, animated: true });
  }, [highlightedWord]);

  const highlightedCells = useMemo((): Set<CellKey> => {
    if (!highlightedWord) return new Set();
    const keys = new Set<CellKey>();
    for (let i = 0; i < highlightedWord.word.length; i++) {
      const col = highlightedWord.direction === "horizontal" ? highlightedWord.startCol + i : highlightedWord.startCol;
      const row = highlightedWord.direction === "vertical" ? highlightedWord.startRow + i : highlightedWord.startRow;
      keys.add(`${col},${row}`);
    }
    return keys;
  }, [highlightedWord]);

  // ── Step navigation ──────────────────────────────────────────────────────────

  const goToStep2 = () => {
    if (savedBoard && savedBoard.tiles.length > 0) {
      initEditorFromSavedBoard(savedBoard);
    } else {
      initEditorFromOCR();
    }
    setHighlightedWord(null);
    setStep(2);
    if (!dict) {
      loadDictionary().then(setDict).catch((e) => console.warn("[Dict] failed to load:", e));
    }
  };

  const goToStep3 = () => {
    const tiles: BoardCell[] = [];
    for (const [k, v] of editorCells) {
      const [col, row] = k.split(",").map(Number);
      tiles.push({ letter: v.letter, col, row });
    }
    const words = deriveWordsFromGrid(editorCells);
    setSavedBoard({ tiles, words });
    setSelecting(null);
    setStep(3);
  };

  const backToStep2 = (board: StoredBoard | null) => {
    if (board && board.tiles.length > 0) {
      initEditorFromSavedBoard(board);
    } else {
      initEditorFromOCR();
    }
    setHighlightedWord(null);
    setStep(2);
  };

  // ── Save ─────────────────────────────────────────────────────────────────────

  const selectedPlayers = useMemo(
    () => players.filter((p) => selectedIds.includes(p.id)),
    [players, selectedIds]
  );

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (winnerId && !next.includes(winnerId)) setWinnerId("");
      return next;
    });

  const handleCreatePlayer = async (name: string) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const p = await createPlayer(name);
    await refreshPlayers();
    setSelectedIds((prev) => [...prev, p.id]);
  };

  const handleSave = async () => {
    if (selectedIds.length === 0) { Alert.alert("Select players", "Pick who played this game."); return; }
    if (!winnerId) { Alert.alert("Select winner", "Pick the winner."); return; }
    setSaving(true);
    try {
      await createGame({ playedAtISO, durationSeconds, playerIds: selectedIds, winnerId, board: savedBoard ?? undefined });
      await onSaved();
      onClose();
      // Determine celebration type: all words valid → bananas, any invalid → rotten
      const words = savedBoard?.words ?? [];
      const allValid = words.length === 0 || (dict !== null && words.every((w) => dict.has(w.word.toUpperCase())));
      setCelebration(allValid ? "bananas" : "rotten");
    } catch (e: any) {
      Alert.alert("Could not save game", e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const avgConf = ocrResult && ocrResult.tiles.length > 0
    ? Math.round(ocrResult.tiles.reduce((s, t) => s + t.confidence, 0) / ocrResult.tiles.length)
    : null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {celebration && (
        <CelebrationOverlay
          type={celebration}
          onDone={() => setCelebration(null)}
        />
      )}
      <Modal visible={visible} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 20 }}>
          <View style={{
            backgroundColor: "white", borderRadius: 16,
            ...(step === 2 ? { height: "88%" } : { maxHeight: "90%" }),
            shadowColor: "#000", shadowOpacity: 0.15,
            shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6, overflow: "hidden",
          }}>

            {/* ── Header ── */}
            <View style={{ padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
              <Text style={{ fontSize: 22, fontWeight: "700", marginBottom: 12 }}>Save Game</Text>

              {/* Step indicator */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "center" }}>
                {STEP_LABELS.map((label, i) => {
                  const stepNum = (i + 1) as 1 | 2 | 3;
                  const active = step === stepNum;
                  const done = step > stepNum;
                  return (
                    <View key={stepNum} style={{ flexDirection: "row", alignItems: "center", flex: stepNum < 3 ? 1 : undefined }}>
                      <View style={{ alignItems: "center" }}>
                        <View style={{
                          width: 28, height: 28, borderRadius: 14,
                          backgroundColor: active ? "#111" : done ? "#555" : "#eee",
                          justifyContent: "center", alignItems: "center",
                        }}>
                          <Text style={{ color: active || done ? "white" : "#aaa", fontSize: 13, fontWeight: "700" }}>{stepNum}</Text>
                        </View>
                        <Text style={{ fontSize: 10, color: active ? "#111" : "#999", marginTop: 3, fontWeight: active ? "600" : "400" }}>{label}</Text>
                      </View>
                      {stepNum < 3 && (
                        <View style={{ flex: 1, height: 1, backgroundColor: done ? "#555" : "#ddd", marginHorizontal: 6, marginBottom: 14 }} />
                      )}
                    </View>
                  );
                })}
              </View>
            </View>

            {/* ── Step 1: Scan Board ── */}
            {step === 1 && (
              <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
                <View style={{ gap: 8 }}>
                  <Text style={{ fontWeight: "600" }}>Board Photo</Text>

                  {Platform.OS === "web" ? (
                    <>
                      {ocrRunning ? (
                        /* ── Scanning in progress: progress bar replaces button ── */
                        <View style={{ borderRadius: 12, borderWidth: 1, borderColor: "#ccc", padding: 14, gap: 10 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Text style={{ fontSize: 13, color: "#555", fontWeight: "600" }}>
                              {ocrProgress === null
                                ? "Detecting tiles…"
                                : ocrProgress.identified < ocrProgress.detected
                                ? `Identifying tiles… ${ocrProgress.identified} / ${ocrProgress.detected}`
                                : "Finishing up…"}
                            </Text>
                            {ocrProgress !== null && (
                              <Text style={{ fontSize: 12, color: "#888" }}>
                                {Math.round((ocrProgress.identified / ocrProgress.detected) * 100)}%
                              </Text>
                            )}
                          </View>

                          {/* Track */}
                          <View style={{ height: 8, backgroundColor: "#eee", borderRadius: 4, overflow: "hidden" }}>
                            {ocrProgress !== null && (
                              <View style={{
                                height: 8, borderRadius: 4, backgroundColor: "#1a73e8",
                                width: `${Math.round((ocrProgress.identified / ocrProgress.detected) * 100)}%`,
                              }} />
                            )}
                          </View>

                          {/* Original photo thumbnail while scanning */}
                          {previewUrl && (
                            <Image source={{ uri: previewUrl }} style={{ width: "100%", height: 120, borderRadius: 6 }} resizeMode="contain" />
                          )}
                        </View>
                      ) : (
                        /* ── Idle / done: normal button ── */
                        <Pressable
                          onPress={handleChoosePhoto}
                          style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#ccc", alignItems: "center" }}
                        >
                          <Text>{previewUrl ? "Rescan / Change photo" : "Upload / Take photo"}</Text>
                        </Pressable>
                      )}

                      {ocrResult && !ocrRunning && (
                        <View style={{ gap: 12 }}>
                          <View style={{ gap: 4 }}>
                            <Text style={{ fontSize: 11, fontWeight: "600", color: "#888" }}>
                              DETECTED BOARD  (green ≥80%  orange ≥50%  red &lt;50% / missed)
                            </Text>
                            <Image
                              source={{ uri: ocrResult.debugImageUrl }}
                              style={{ width: "100%", height: 200, borderRadius: 8, backgroundColor: "#f0f0f0" }}
                              resizeMode="contain"
                            />
                          </View>

                          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
                            <Text style={{ color: "#444" }}>
                              Tiles: <Text style={{ fontWeight: "700" }}>{ocrResult.tiles.length}</Text>
                            </Text>
                            {avgConf !== null && (
                              <Text style={{ color: "#444" }}>
                                Avg confidence: <Text style={{ fontWeight: "700" }}>{avgConf}%</Text>
                              </Text>
                            )}
                          </View>

                          {ocrResult.tiles.length > 0 && (
                            <View>
                              <Pressable
                                onPress={() => setShowTileDebug((v) => !v)}
                                style={{ alignSelf: "flex-start", paddingVertical: 4 }}
                              >
                                <Text style={{ fontSize: 11, color: "#aaa" }}>
                                  {showTileDebug ? "▾ Hide tile debug" : "▸ Show tile debug"}
                                </Text>
                              </Pressable>

                              {showTileDebug && (
                                <View style={{ gap: 8, marginTop: 6 }}>
                                  <Text style={{ fontSize: 11, color: "#888" }}>
                                    Each card shows the processed image fed to Tesseract. If the letter looks wrong here, it's a crop/threshold issue.
                                  </Text>
                                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                                    {ocrResult.tiles.map((tile, i) => {
                                      const bg =
                                        tile.confidence >= 80 ? "#c8e6c9" :
                                        tile.confidence >= 50 ? "#fff3e0" : "#ffcdd2";
                                      return (
                                        <View key={i} style={{ alignItems: "center", gap: 3, width: 80 }}>
                                          <Text style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace" }}>#{i + 1}</Text>
                                          <Image
                                            source={{ uri: tile.debugUrl }}
                                            style={{ width: 68, height: 68, borderRadius: 4, borderWidth: 1, borderColor: "#aaa", backgroundColor: "#fff" }}
                                            resizeMode="contain"
                                          />
                                          <View style={{ backgroundColor: bg, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, alignItems: "center" }}>
                                            <Text style={{ fontFamily: "monospace", fontWeight: "700", fontSize: 16 }}>{tile.letter} {tile.confidence}%</Text>
                                          </View>
                                        </View>
                                      );
                                    })}
                                  </View>
                                </View>
                              )}
                            </View>
                          )}

                          {ocrResult.tiles.length === 0 && (
                            <Text style={{ color: "#c00" }}>
                              No tiles detected. Try better lighting or a more overhead angle.
                            </Text>
                          )}
                        </View>
                      )}
                    </>
                  ) : (
                    <Text style={{ color: "#666" }}>OCR is web-only for now.</Text>
                  )}
                </View>
              </ScrollView>
            )}

            {/* ── Step 2: Edit Board ── */}
            {step === 2 && (
              <View style={{ flex: 1 }}>
                {/* Legend */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ width: 14, height: 14, backgroundColor: "#FFF8E1", borderWidth: 1, borderColor: "#F9A825", borderRadius: 2 }} />
                    <Text style={{ fontSize: 11, color: "#666" }}>OCR detected</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ width: 14, height: 14, backgroundColor: "#FFF0E0", borderWidth: 1, borderColor: "#E65100", borderRadius: 2 }} />
                    <Text style={{ fontSize: 11, color: "#666" }}>Low confidence</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ width: 14, height: 14, backgroundColor: "#E8F5E9", borderWidth: 1, borderColor: "#388E3C", borderRadius: 2 }} />
                    <Text style={{ fontSize: 11, color: "#666" }}>Manually added</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ width: 14, height: 14, backgroundColor: "#fafafa", borderWidth: 1, borderColor: "#ddd", borderRadius: 2 }} />
                    <Text style={{ fontSize: 11, color: "#666" }}>Empty (tap to add)</Text>
                  </View>
                </View>

                {/* Grid — horizontally + vertically scrollable */}
                <ScrollView
                  ref={hScrollRef}
                  horizontal
                  style={{ flex: 1 }}
                  onLayout={(e) => {
                    gridViewport.current.width  = e.nativeEvent.layout.width;
                    gridViewport.current.height = e.nativeEvent.layout.height;
                  }}
                >
                  <ScrollView ref={vScrollRef} contentContainerStyle={{ padding: 8 }}>
                    {Array.from({ length: gridRows }, (_, row) => (
                      <View key={row} style={{ flexDirection: "row" }}>
                        {Array.from({ length: gridCols }, (_, col) => {
                          const cell = editorCells.get(`${col},${row}`);
                          const isSelected = selecting?.col === col && selecting?.row === row;

                          const key = `${col},${row}`;
                          const lowConfidence = cell?.source === "ocr" && cell.confidence !== undefined && cell.confidence < 70;
                          const isHighlighted = highlightedCells.has(key);

                          const bg = isSelected
                            ? "#E3F2FD"
                            : isHighlighted
                            ? "#EDE7F6"
                            : lowConfidence
                            ? "#FFF0E0"
                            : cell?.source === "ocr"
                            ? "#FFF8E1"
                            : cell?.source === "manual"
                            ? "#E8F5E9"
                            : "#fafafa";

                          const borderColor = isSelected
                            ? "#1a73e8"
                            : isHighlighted
                            ? "#7B1FA2"
                            : lowConfidence
                            ? "#E65100"
                            : cell?.source === "ocr"
                            ? "#F9A825"
                            : cell?.source === "manual"
                            ? "#388E3C"
                            : "#e0e0e0";

                          return (
                            <Pressable
                              key={col}
                              onPress={() => handleCellPress(col, row)}
                              style={{
                                width: CELL, height: CELL,
                                margin: 1,
                                borderRadius: 5,
                                borderWidth: isSelected ? 2 : 1,
                                borderColor,
                                backgroundColor: bg,
                                justifyContent: "center",
                                alignItems: "center",
                              }}
                            >
                              {cell && (
                                <Text style={{ fontSize: 20, fontWeight: "700", color: "#222" }}>
                                  {cell.letter}
                                </Text>
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </ScrollView>
                </ScrollView>

                {/* Word list strip */}
                <View style={{ borderTopWidth: 1, borderTopColor: "#f0f0f0", backgroundColor: "#fafafa", paddingHorizontal: 12, paddingVertical: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: "#888", marginBottom: 6 }}>
                    {sortedWords.length > 0
                      ? `WORDS (${sortedWords.length})${dict === null ? " — checking…" : ""}`
                      : "NO WORDS DETECTED"}
                  </Text>
                  {sortedWords.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {sortedWords.map((w, i) => {
                        const valid = dict === null ? true : dict.has(w.word.toUpperCase());
                        const isActive = highlightedWord === w || (
                          highlightedWord?.word === w.word &&
                          highlightedWord?.startCol === w.startCol &&
                          highlightedWord?.startRow === w.startRow
                        );

                        const chipBorderColor = !valid
                          ? "#EF9A9A"
                          : isActive
                          ? "#7B1FA2"
                          : w.direction === "horizontal" ? "#90CAF9" : "#CE93D8";

                        const chipBg = !valid
                          ? "#FFEBEE"
                          : isActive
                          ? "#EDE7F6"
                          : w.direction === "horizontal" ? "#E3F2FD" : "#F3E5F5";

                        return (
                          <Pressable
                            key={i}
                            onPress={() => {
                              setSelecting(null);
                              setHighlightedWord((prev) =>
                                prev?.word === w.word && prev?.startCol === w.startCol && prev?.startRow === w.startRow
                                  ? null
                                  : w
                              );
                            }}
                            style={{
                              paddingHorizontal: 9, paddingVertical: 4,
                              borderRadius: 7, borderWidth: isActive ? 2 : 1,
                              borderColor: chipBorderColor,
                              backgroundColor: chipBg,
                            }}
                          >
                            <Text style={{ fontWeight: "700", fontFamily: "monospace", fontSize: 14, color: !valid ? "#C62828" : "#222" }}>
                              {w.word}
                            </Text>
                            <Text style={{ fontSize: 9, color: !valid ? "#EF5350" : "#888", textAlign: "center" }}>
                              {!valid ? "invalid" : w.direction === "horizontal" ? "→" : "↓"}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : (
                    <Text style={{ fontSize: 11, color: "#bbb", fontStyle: "italic" }}>Add tiles to form words of 2+ letters.</Text>
                  )}
                </View>

                {/* Letter picker — shown when a cell is selected */}
                {selecting && (
                  Platform.OS === "web" ? (
                    /* ── Web: custom QWERTY keyboard ── */
                    <View style={{
                      borderTopWidth: 1, borderTopColor: "#e0e0e0",
                      backgroundColor: "#fff", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 16,
                    }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <Text style={{ fontSize: 13, color: "#555" }}>
                          {editorCells.get(`${selecting.col},${selecting.row}`)
                            ? `Change letter at (${selecting.col}, ${selecting.row})`
                            : `Add tile at (${selecting.col}, ${selecting.row})`}
                        </Text>
                        <Pressable onPress={() => setSelecting(null)} style={{ padding: 4 }}>
                          <Text style={{ fontSize: 16, color: "#888" }}>✕</Text>
                        </Pressable>
                      </View>

                      <View style={{ gap: KEY_GAP }}>
                        {KEYBOARD_ROWS.map((row, rowIndex) => (
                          <View key={rowIndex} style={{ flexDirection: "row", gap: KEY_GAP, marginLeft: ROW_OFFSETS[rowIndex] }}>
                            {row.map((l) => (
                              <Pressable
                                key={l}
                                onPress={() => handleLetterSelect(l)}
                                style={{
                                  width: KEY_SIZE, height: KEY_SIZE + 4,
                                  backgroundColor: "#f5f5f5",
                                  borderRadius: 5,
                                  borderWidth: 1, borderColor: "#ddd",
                                  justifyContent: "center", alignItems: "center",
                                }}
                              >
                                <Text style={{ fontWeight: "700", fontSize: 14 }}>{l}</Text>
                              </Pressable>
                            ))}

                            {rowIndex === 2 && editorCells.get(`${selecting.col},${selecting.row}`) && (
                              <Pressable
                                onPress={handleClearCell}
                                style={{
                                  width: KEY_SIZE + 10, height: KEY_SIZE + 4,
                                  backgroundColor: "#FFEBEE",
                                  borderRadius: 5,
                                  borderWidth: 1, borderColor: "#FFCDD2",
                                  justifyContent: "center", alignItems: "center",
                                  marginLeft: KEY_GAP,
                                }}
                              >
                                <Text style={{ fontSize: 15, color: "#C62828" }}>⌫</Text>
                              </Pressable>
                            )}
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : (
                    /* ── Mobile: native keyboard via TextInput ── */
                    <KeyboardAvoidingView behavior="padding">
                      <View style={{
                        borderTopWidth: 1, borderTopColor: "#e0e0e0",
                        backgroundColor: "#fff", padding: 12, gap: 10,
                      }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 13, color: "#555" }}>
                            {editorCells.get(`${selecting.col},${selecting.row}`) ? "Change letter" : "Add tile"}
                          </Text>
                          <Pressable
                            onPress={() => { Keyboard.dismiss(); setSelecting(null); }}
                            style={{ paddingHorizontal: 14, paddingVertical: 6, backgroundColor: "#111", borderRadius: 8 }}
                          >
                            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Done</Text>
                          </Pressable>
                        </View>

                        <TextInput
                          autoFocus
                          maxLength={1}
                          autoCapitalize="characters"
                          autoCorrect={false}
                          returnKeyType="done"
                          placeholder="Type a letter…"
                          placeholderTextColor="#bbb"
                          onChangeText={(text) => {
                            const letter = text.replace(/[^A-Za-z]/g, "").toUpperCase().slice(-1);
                            if (!letter) return;
                            Keyboard.dismiss();
                            handleLetterSelect(letter);
                          }}
                          onSubmitEditing={() => { Keyboard.dismiss(); setSelecting(null); }}
                          style={{
                            borderWidth: 1, borderColor: "#ddd", borderRadius: 10,
                            padding: 14, fontSize: 28, fontWeight: "700",
                            textAlign: "center", backgroundColor: "#f9f9f9", color: "#111",
                          }}
                        />

                        {editorCells.get(`${selecting.col},${selecting.row}`) && (
                          <Pressable
                            onPress={() => { Keyboard.dismiss(); handleClearCell(); }}
                            style={{ padding: 12, backgroundColor: "#FFEBEE", borderRadius: 8, alignItems: "center", borderWidth: 1, borderColor: "#FFCDD2" }}
                          >
                            <Text style={{ color: "#C62828", fontWeight: "600" }}>Clear tile</Text>
                          </Pressable>
                        )}
                      </View>
                    </KeyboardAvoidingView>
                  )
                )}
              </View>
            )}

            {/* ── Step 3: Players & Winner ── */}
            {step === 3 && (
              <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontWeight: "600" }}>Players</Text>
                  <Pressable onPress={async () => {
                    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    setAddModalOpen(true);
                  }}>
                    <Text style={{ fontSize: 16 }}>+ Add Player</Text>
                  </Pressable>
                </View>
                <PlayerMultiSelect players={players} selectedIds={selectedIds} onToggle={toggle} />

                <View style={{ gap: 8 }}>
                  <Text style={{ fontWeight: "600" }}>Winner</Text>
                  {selectedPlayers.length === 0 ? (
                    <Text style={{ color: "#666" }}>Select players first.</Text>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {selectedPlayers.map((p) => {
                        const selected = winnerId === p.id;
                        return (
                          <Pressable
                            key={p.id}
                            onPress={() => setWinnerId(p.id)}
                            style={{
                              padding: 12, borderWidth: 1, borderRadius: 10,
                              borderColor: selected ? "#333" : "#ccc",
                              backgroundColor: selected ? "#eaeaea" : "white",
                              flexDirection: "row", justifyContent: "space-between",
                            }}
                          >
                            <Text style={{ fontSize: 16 }}>{p.name}</Text>
                            <Text>{selected ? "🏆" : ""}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              </ScrollView>
            )}

            {/* ── Pinned footer ── */}
            <View style={{
              padding: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#eee",
              flexDirection: "row", justifyContent: "space-between", gap: 12, backgroundColor: "white",
            }}>
              <Pressable onPress={onClose} disabled={saving} style={{ padding: 12 }}>
                <Text style={{ color: "#666" }}>Cancel</Text>
              </Pressable>

              <View style={{ flexDirection: "row", gap: 10 }}>
                {step > 1 && (
                  <Pressable
                    onPress={() => {
                      if (step === 2) setStep(1);
                      else backToStep2(savedBoard);
                    }}
                    style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#ddd" }}
                  >
                    <Text style={{ color: "#444" }}>← Back</Text>
                  </Pressable>
                )}

                {step === 1 && (
                  <Pressable
                    onPress={goToStep2}
                    disabled={ocrRunning}
                    style={{ padding: 12, backgroundColor: ocrRunning ? "#bbb" : "#111", borderRadius: 10, opacity: ocrRunning ? 0.6 : 1 }}
                  >
                    <Text style={{ color: "white" }}>{ocrRunning ? "Scanning…" : "Next →"}</Text>
                  </Pressable>
                )}

                {step === 2 && (
                  <Pressable
                    onPress={goToStep3}
                    style={{ padding: 12, backgroundColor: "#111", borderRadius: 10 }}
                  >
                    <Text style={{ color: "white" }}>Next →</Text>
                  </Pressable>
                )}

                {step === 3 && (
                  <Pressable
                    onPress={handleSave}
                    disabled={saving}
                    style={{ padding: 12, backgroundColor: "#111", borderRadius: 10 }}
                  >
                    <Text style={{ color: "white" }}>{saving ? "Saving…" : "Save"}</Text>
                  </Pressable>
                )}
              </View>
            </View>

            <AddPlayerSheet
              visible={addModalOpen}
              onClose={async () => {
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setAddModalOpen(false);
              }}
              onCreate={handleCreatePlayer}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
