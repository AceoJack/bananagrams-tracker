import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, Text, View, ScrollView, Platform } from "react-native";
import type { Player } from "../db/queries.firestore";
import { createGame, createPlayer, listPlayers } from "../db/queries.firestore";
import { PlayerMultiSelect } from "./PlayerMultiSelect";
import { AddPlayerSheet } from "./AddPlayerSheet";
import * as Haptics from "expo-haptics";
import { runOCRFromBlob } from "../utils/ocr";

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
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [winnerId, setWinnerId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const handleChoosePhotoWeb = async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      // @ts-ignore
      input.capture = "environment";

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;

        setOcrRunning(true);

        try {
          // keep a reference to the picked file so the UI can show "Change photo"
          setPhotoBlob(file);

          const { rawText, words } = await runOCRFromBlob(file);

          console.log("OCR raw text:\n", rawText);

          const cleanedWords = words
            .map((w) => w.text.toUpperCase().replace(/[^A-Z]/g, ""))
            .filter((w) => w.length >= 2);

          console.log("OCR words:", cleanedWords);
          console.log("OCR word boxes (first 20):", words.slice(0, 20));
        } catch (e) {
          console.error("OCR failed:", e);
        } finally {
          setOcrRunning(false);
        }
      };

      input.click();
    } catch (e) {
      console.error("File picker failed:", e);
    }
  };

  const refreshPlayers = async () => {
    const rows = await listPlayers();
    setPlayers(rows);
  };

  useEffect(() => {
    if (visible) {
      refreshPlayers();
      setSelectedIds([]);
      setWinnerId("");
    }
  }, [visible]);

  const selectedPlayers = useMemo(
    () => players.filter((p) => selectedIds.includes(p.id)),
    [players, selectedIds]
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // if winner removed, clear winner
      if (winnerId && !next.includes(winnerId)) setWinnerId("");
      return next;
    });
  };

  const handleCreatePlayer = async (name: string) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const newPlayer = await createPlayer(name);
    await refreshPlayers();
    // auto-select newly created player
    setSelectedIds((prev) => [...prev, newPlayer.id]);
  };

  const openAddPlayer = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAddModalOpen(true);
  };

  const cancelAddPlayer = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAddModalOpen(false);
  };

  const handleSave = async () => {
    if (selectedIds.length === 0) {
      Alert.alert("Select players", "Pick who played this game.");
      return;
    }
    if (!winnerId) {
      Alert.alert("Select winner", "Pick the winner.");
      return;
    }

    setSaving(true);
    try {
      await createGame({
        playedAtISO,
        durationSeconds,
        playerIds: selectedIds,
        winnerId,
      });
      await onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert("Could not save game", e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      {/* Backdrop */}
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.35)",
          justifyContent: "center",
          padding: 20,
        }}
      >
        {/* Card */}
        <View
          style={{
            position: "relative",
            backgroundColor: "white",
            borderRadius: 16,
            maxHeight: "85%",
            shadowColor: "#000",
            shadowOpacity: 0.15,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,

            // IMPORTANT: makes rounded corners apply to the scrolling content too
            overflow: "hidden",
          }}
        >
          <View style={{ gap: 8, marginTop: 10 }}>
            <Text style={{ fontWeight: "600" }}>Board photo (OCR)</Text>
            {Platform.OS === "web" ? (
              <Pressable
                onPress={handleChoosePhotoWeb}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ccc",
                  backgroundColor: "white",
                }}
                disabled={ocrRunning}
              >
                <Text>{ocrRunning ? "Scanning..." : photoBlob ? "Change photo" : "Upload / Take photo"}</Text>
              </Pressable>
            ) : (
              <Text style={{ color: "#666" }}>
                OCR upload is set up for web right now. We can add mobile picking next.
              </Text>
            )}
          </View>

          {/* Scrollable content */}
          <ScrollView
            contentContainerStyle={{
              padding: 20,
              gap: 14,
              paddingBottom: 12, // breathing room above footer
            }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={{ fontSize: 22, fontWeight: "700" }}>Save Game</Text>

            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "600" }}>Players</Text>
              <Pressable onPress={openAddPlayer}>
                <Text style={{ fontSize: 16 }}>+ Add Player</Text>
              </Pressable>
            </View>

            <PlayerMultiSelect players={players} selectedIds={selectedIds} onToggle={toggle} />

            <View style={{ marginTop: 8, gap: 8 }}>
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
                          padding: 12,
                          borderWidth: 1,
                          borderRadius: 10,
                          borderColor: selected ? "#333" : "#ccc",
                          backgroundColor: selected ? "#eaeaea" : "white",
                          flexDirection: "row",
                          justifyContent: "space-between",
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

          {/* Pinned footer (always visible) */}
          <View
            style={{
              padding: 20,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: "#eee",
              flexDirection: "row",
              justifyContent: "flex-end",
              gap: 12,
              backgroundColor: "white",
            }}
          >
            <Pressable onPress={onClose} disabled={saving} style={{ padding: 12 }}>
              <Text>Cancel</Text>
            </Pressable>

            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={{ padding: 12, backgroundColor: "#111", borderRadius: 10 }}
            >
              <Text style={{ color: "white" }}>{saving ? "Saving..." : "Save"}</Text>
            </Pressable>
          </View>

          {/* Overlay MUST be inside card so it fully covers it */}
          <AddPlayerSheet
            visible={addModalOpen}
            onClose={cancelAddPlayer}
            onCreate={handleCreatePlayer}
          />
        </View>
      </View>
    </Modal>
  );
}