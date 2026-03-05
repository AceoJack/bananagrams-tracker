import { Pressable, Text, View } from "react-native";
import type { Player } from "../db/queries.firestore";

export function PlayerMultiSelect({
  players,
  selectedIds,
  onToggle,
}: {
  players: Player[];
  selectedIds: string[];
  onToggle: (playerId: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {players.map((p) => {
        const selected = selectedIds.includes(p.id);
        return (
          <Pressable
            key={p.id}
            onPress={() => onToggle(p.id)}
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
            <Text>{selected ? "✓" : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}