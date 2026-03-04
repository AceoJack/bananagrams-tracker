import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, Text, View } from "react-native";
import type { PlayerRow } from "../db/queries";
import { createGame, createPlayer, listPlayers } from "../db/queries";
import { PlayerMultiSelect } from "./PlayerMultiSelect";
import { AddPlayerModal } from "./AddPlayerModal";

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
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [winnerId, setWinnerId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

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
    const newPlayer = await createPlayer(name);
    await refreshPlayers();
    // auto-select newly created player
    setSelectedIds((prev) => [...prev, newPlayer.id]);
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
    <>
      <Modal visible={visible} animationType="slide">
        <View style={{ flex: 1, padding: 16, gap: 14 }}>
          <Text style={{ fontSize: 22, fontWeight: "700" }}>Save Game</Text>

          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontWeight: "600" }}>Players</Text>
            <Pressable onPress={() => setAddModalOpen(true)}>
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

          <View style={{ flex: 1 }} />

          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
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
        </View>
      </Modal>

      <AddPlayerModal
        visible={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onCreate={handleCreatePlayer}
      />
    </>
  );
}