import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { Player } from "../db/queries.firestore";
import { createGame, createPlayer, listPlayers } from "../db/queries.firestore";
import type { OCRResult } from "../utils/ocr";
import { runOCR } from "../utils/ocr";
import { AddPlayerSheet } from "./AddPlayerSheet";
import { PlayerMultiSelect } from "./PlayerMultiSelect";
import { TemplateSetup } from "./TemplateSetup";
import * as Haptics from "expo-haptics";

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
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [templateSetupOpen, setTemplateSetupOpen] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [winnerId, setWinnerId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const objectUrls = useRef<string[]>([]);
  const track = (url: string) => { objectUrls.current.push(url); return url; };
  const revokeAll = () => {
    objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.current = [];
  };

  const handleChoosePhoto = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    // @ts-ignore
    input.capture = "environment";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      revokeAll();
      setOcrResult(null);
      setPreviewUrl(track(URL.createObjectURL(file)));
      setOcrRunning(true);

      try {
        const result = await runOCR(file);
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

  const refreshPlayers = async () => setPlayers(await listPlayers());

  useEffect(() => {
    if (visible) {
      refreshPlayers();
      setSelectedIds([]);
      setWinnerId("");
    } else {
      revokeAll();
      setPreviewUrl(null);
      setOcrResult(null);
    }
  }, [visible]);

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
      await createGame({ playedAtISO, durationSeconds, playerIds: selectedIds, winnerId });
      await onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert("Could not save game", e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const avgConf = ocrResult && ocrResult.tiles.length > 0
    ? Math.round(ocrResult.tiles.reduce((s, t) => s + t.confidence, 0) / ocrResult.tiles.length)
    : null;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 20 }}>
        <View style={{
          position: "relative", backgroundColor: "white", borderRadius: 16,
          maxHeight: "90%", shadowColor: "#000", shadowOpacity: 0.15,
          shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6, overflow: "hidden",
        }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 22, fontWeight: "700" }}>Save Game</Text>

            {/* ── Board photo ── */}
            <View style={{ gap: 8 }}>
              <Text style={{ fontWeight: "600" }}>Board Photo</Text>

              {Platform.OS === "web" ? (
                <>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={handleChoosePhoto}
                      disabled={ocrRunning}
                      style={{ flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#ccc", alignItems: "center" }}
                    >
                      <Text>{ocrRunning ? "Scanning…" : previewUrl ? "Change photo" : "Upload / Take photo"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setTemplateSetupOpen(true)}
                      style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#ccc", alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ fontSize: 12, color: "#666" }}>⚙ Templates</Text>
                    </Pressable>
                  </View>

                  {/* Original photo thumbnail */}
                  {previewUrl && (
                    <Image source={{ uri: previewUrl }} style={{ width: "100%", height: 140, borderRadius: 8 }} resizeMode="contain" />
                  )}

                  {ocrRunning && (
                    <Text style={{ color: "#888", fontStyle: "italic" }}>Detecting tiles…</Text>
                  )}

                  {/* ── OCR results ── */}
                  {ocrResult && !ocrRunning && (
                    <View style={{ gap: 12 }}>

                      {/* Annotated debug image */}
                      <View style={{ gap: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: "#888" }}>
                          DETECTED TILES  (green ≥80%  orange ≥50%  red &lt;50% / missed)
                        </Text>
                        <Image
                          source={{ uri: ocrResult.debugImageUrl }}
                          style={{ width: "100%", height: 200, borderRadius: 8, backgroundColor: "#f0f0f0" }}
                          resizeMode="contain"
                        />
                      </View>

                      {/* Summary row */}
                      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
                        <Text style={{ color: "#444" }}>
                          Tiles: <Text style={{ fontWeight: "700" }}>{ocrResult.tiles.length}</Text>
                        </Text>
                        {avgConf !== null && (
                          <Text style={{ color: "#444" }}>
                            Avg confidence: <Text style={{ fontWeight: "700" }}>{avgConf}%</Text>
                          </Text>
                        )}
                        <Text style={{ color: ocrResult.templateCount === 26 ? "#2e7d32" : "#999" }}>
                          {ocrResult.templateCount === 26
                            ? "✓ Template matching"
                            : ocrResult.templateCount > 0
                            ? `Templates: ${ocrResult.templateCount}/26`
                            : "Tesseract fallback"}
                        </Text>
                      </View>

                      {/* Individual tile debug cards */}
                      {ocrResult.tiles.length > 0 && (
                        <View style={{ gap: 8 }}>
                          <Text style={{ fontWeight: "600" }}>Tile Debug</Text>
                          <Text style={{ fontSize: 11, color: "#888" }}>
                            Each card shows the processed image fed to the matcher. If the letter looks wrong here, it's a crop/threshold issue. If it looks correct but matched the wrong letter, it's a template quality issue.
                          </Text>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                            {ocrResult.tiles.map((tile, i) => {
                              const bg =
                                tile.confidence >= 80 ? "#c8e6c9" :
                                tile.confidence >= 50 ? "#fff3e0" : "#ffcdd2";
                              return (
                                <View key={i} style={{ alignItems: "center", gap: 3, width: 148 }}>
                                  <Text style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace" }}>#{i + 1}</Text>

                                  {/* Side-by-side: what the app saw vs what the template looks like */}
                                  <View style={{ flexDirection: "row", gap: 4 }}>
                                    <View style={{ alignItems: "center", gap: 2 }}>
                                      <Image
                                        source={{ uri: tile.debugUrl }}
                                        style={{ width: 68, height: 68, borderRadius: 4, borderWidth: 1, borderColor: "#aaa", backgroundColor: "#fff" }}
                                        resizeMode="contain"
                                      />
                                      <Text style={{ fontSize: 9, color: "#888" }}>tile</Text>
                                    </View>
                                    <View style={{ alignItems: "center", gap: 2 }}>
                                      {tile.matchedTemplateUrl ? (
                                        <Image
                                          source={{ uri: tile.matchedTemplateUrl }}
                                          style={{ width: 68, height: 68, borderRadius: 4, borderWidth: 1, borderColor: "#aaa", backgroundColor: "#fff" }}
                                          resizeMode="contain"
                                        />
                                      ) : (
                                        <View style={{ width: 68, height: 68, borderRadius: 4, borderWidth: 1, borderColor: "#ddd", backgroundColor: "#f5f5f5", justifyContent: "center", alignItems: "center" }}>
                                          <Text style={{ fontSize: 9, color: "#bbb" }}>no tmpl</Text>
                                        </View>
                                      )}
                                      <Text style={{ fontSize: 9, color: "#888" }}>template</Text>
                                    </View>
                                  </View>

                                  {/* Best match */}
                                  <View style={{ backgroundColor: bg, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, alignItems: "center" }}>
                                    <Text style={{ fontFamily: "monospace", fontWeight: "700", fontSize: 16 }}>{tile.letter} {tile.confidence}%</Text>
                                  </View>

                                  {/* Runner-ups */}
                                  <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
                                    {tile.topMatches.slice(1, 4).map((m, j) => (
                                      <Text key={j} style={{ fontSize: 9, color: "#999" }}>
                                        {m.letter} {m.confidence}%
                                      </Text>
                                    ))}
                                  </View>
                                </View>
                              );
                            })}
                          </View>
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

            {/* ── Players ── */}
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

            {/* ── Winner ── */}
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

          {/* Pinned footer */}
          <View style={{
            padding: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#eee",
            flexDirection: "row", justifyContent: "flex-end", gap: 12, backgroundColor: "white",
          }}>
            <Pressable onPress={onClose} disabled={saving} style={{ padding: 12 }}>
              <Text>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSave} disabled={saving}
              style={{ padding: 12, backgroundColor: "#111", borderRadius: 10 }}
            >
              <Text style={{ color: "white" }}>{saving ? "Saving…" : "Save"}</Text>
            </Pressable>
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

      <TemplateSetup
        visible={templateSetupOpen}
        onClose={() => setTemplateSetupOpen(false)}
      />
    </Modal>
  );
}
