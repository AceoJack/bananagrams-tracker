import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

export function AddPlayerSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!visible) return null;

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert("Missing name", "Enter a player name.");
      return;
    }
    setSaving(true);
    try {
      await onCreate(trimmed);
      setName("");
      onClose();
    } catch (e: any) {
      Alert.alert("Could not create player", e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View
      style={{
        zIndex: 9999,
        elevation: 9999,
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.4)",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <View style={{ backgroundColor: "white", borderRadius: 12, padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: "600" }}>Add Player</Text>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          autoCapitalize="words"
          style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12 }}
        />

        <View style={{ flexDirection: "row", gap: 12, justifyContent: "flex-end" }}>
          <Pressable onPress={onClose} disabled={saving} style={{ padding: 12 }}>
            <Text>Cancel</Text>
          </Pressable>

          <Pressable
            onPress={handleCreate}
            disabled={saving}
            style={{ padding: 12, backgroundColor: "#111", borderRadius: 10 }}
          >
            <Text style={{ color: "white" }}>{saving ? "Creating..." : "Create"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}