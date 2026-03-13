/**
 * OcrTestModal — quick dev tool for testing OCR / image-processing changes.
 * Reuses the exact same runOCR pipeline as the save-game flow.
 * Add/remove this from split.tsx when needed.
 */
import { useRef, useState } from "react";
import { Image, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { runOCR, OCRCancelledError, type OCRResult } from "../utils/ocr";

export function OcrTestModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ identified: number; detected: number } | null>(null);
  const [result, setResult] = useState<OCRResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    setScanning(false);
    setProgress(null);
    setResult(null);
    setError(null);
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setScanning(false);
    setProgress(null);
  };

  const handleChoosePhoto = () => {
    if (Platform.OS !== "web") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      reset();
      setScanning(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await runOCR(file, (identified, detected) => {
          setProgress({ identified, detected });
        }, controller.signal);
        setResult(res);
      } catch (e: any) {
        if (!(e instanceof OCRCancelledError)) setError(e?.message ?? "OCR failed");
      } finally {
        setScanning(false);
        abortRef.current = null;
      }
    };
    input.click();
  };

  const avgConf = result && result.tiles.length > 0
    ? Math.round(result.tiles.reduce((s, t) => s + t.confidence, 0) / result.tiles.length)
    : null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%", overflow: "hidden" }}>

          {/* Header */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
            <Text style={{ fontSize: 18, fontWeight: "700" }}>OCR Test</Text>
            <Pressable onPress={() => { reset(); onClose(); }} style={{ padding: 4 }}>
              <Text style={{ fontSize: 18, color: "#888" }}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

            {/* Upload / Rescan */}
            {scanning ? (
              <View style={{ borderRadius: 12, borderWidth: 1, borderColor: "#ccc", padding: 14, gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, color: "#555", fontWeight: "600" }}>
                    {progress === null
                      ? "Detecting tiles…"
                      : progress.identified < progress.detected
                      ? `Identifying tiles… ${progress.identified} / ${progress.detected}`
                      : "Finishing up…"}
                  </Text>
                  {progress !== null && (
                    <Text style={{ fontSize: 12, color: "#888" }}>
                      {Math.round((progress.identified / progress.detected) * 100)}%
                    </Text>
                  )}
                </View>
                <View style={{ height: 8, backgroundColor: "#eee", borderRadius: 4, overflow: "hidden" }}>
                  {progress !== null && (
                    <View style={{
                      height: 8, borderRadius: 4, backgroundColor: "#1a73e8",
                      width: `${Math.round((progress.identified / progress.detected) * 100)}%`,
                    }} />
                  )}
                </View>
                <Pressable
                  onPress={cancel}
                  style={{ alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#FFEBEE", borderRadius: 8, borderWidth: 1, borderColor: "#FFCDD2" }}
                >
                  <Text style={{ fontSize: 13, color: "#C62828", fontWeight: "600" }}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={handleChoosePhoto}
                style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ccc", alignItems: "center", backgroundColor: "#fafafa" }}
              >
                <Text style={{ fontWeight: "600" }}>{result ? "📷 Scan another image" : "📷 Choose image"}</Text>
              </Pressable>
            )}

            {error && (
              <Text style={{ color: "#c00", fontSize: 13 }}>{error}</Text>
            )}

            {/* Annotated debug image */}
            {result && !scanning && (
              <>
                <Text style={{ fontSize: 11, fontWeight: "600", color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Detected Board
                </Text>
                <Image
                  source={{ uri: result.debugImageUrl }}
                  style={{ width: "100%", height: 260, borderRadius: 10, backgroundColor: "#f0f0f0" }}
                  resizeMode="contain"
                />

                {/* Summary stats */}
                <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
                  <StatChip label="Tiles" value={`${result.tiles.length}`} />
                  <StatChip label="Words" value={`${result.words.length}`} />
                  {avgConf !== null && <StatChip label="Avg confidence" value={`${avgConf}%`} color={avgConf >= 80 ? "#2E7D32" : avgConf >= 60 ? "#E65100" : "#C62828"} />}
                  <StatChip
                    label="Low conf tiles"
                    value={`${result.tiles.filter(t => t.confidence < 70).length}`}
                    color={result.tiles.filter(t => t.confidence < 70).length > 0 ? "#C62828" : "#2E7D32"}
                  />
                </View>

                {/* Words detected */}
                {result.words.length > 0 && (
                  <View style={{ gap: 6 }}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Words detected
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {result.words.map((w, i) => (
                        <View key={i} style={{
                          paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                          backgroundColor: w.direction === "horizontal" ? "#E3F2FD" : "#F3E5F5",
                          borderWidth: 1, borderColor: w.direction === "horizontal" ? "#90CAF9" : "#CE93D8",
                        }}>
                          <Text style={{ fontSize: 13, fontWeight: "600", color: w.direction === "horizontal" ? "#1565C0" : "#7B1FA2" }}>
                            {w.word}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Per-tile confidence breakdown */}
                <Text style={{ fontSize: 11, fontWeight: "600", color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Tile breakdown ({result.tiles.length} tiles)
                </Text>
                <Text style={{ fontSize: 11, color: "#aaa" }}>
                  🟢 ≥80%  🟠 ≥50%  🔴 &lt;50%  — tap a tile to see its processed image
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {result.tiles.map((tile, i) => {
                    const bg = tile.confidence >= 80 ? "#c8e6c9" : tile.confidence >= 50 ? "#fff3e0" : "#ffcdd2";
                    const border = tile.confidence >= 80 ? "#81c784" : tile.confidence >= 50 ? "#ffb74d" : "#e57373";
                    return (
                      <View key={i} style={{ alignItems: "center", gap: 3, width: 68 }}>
                        <Image
                          source={{ uri: tile.debugUrl }}
                          style={{ width: 56, height: 56, borderRadius: 6, backgroundColor: bg, borderWidth: 1, borderColor: border }}
                          resizeMode="contain"
                        />
                        <Text style={{ fontSize: 13, fontWeight: "700" }}>{tile.letter}</Text>
                        <Text style={{ fontSize: 10, color: tile.confidence >= 70 ? "#666" : "#C62828" }}>{tile.confidence}%</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function StatChip({ label, value, color = "#111" }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ backgroundColor: "#f3f3f3", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
      <Text style={{ fontSize: 10, color: "#888" }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: "700", color }}>{value}</Text>
    </View>
  );
}
