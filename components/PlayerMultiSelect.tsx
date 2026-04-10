import { Pressable, Text, View } from "react-native";
import type { Guest, PlayerSlot, UserProfile } from "../db/queries.firestore";

/**
 * Two-section player picker for local game setup.
 * "You" (the signed-in user) is shown first, then your guests.
 * Returns selected PlayerSlots via onToggle.
 */
export function PlayerMultiSelect({
  me,
  guests,
  selectedUids,
  onToggle,
}: {
  me: UserProfile;
  guests: Guest[];
  selectedUids: string[];
  onToggle: (slot: PlayerSlot) => void;
}) {
  const meSlot: PlayerSlot = {
    type: "user",
    uid: me.uid,
    ownerUid: null,
    ownerDisplayName: null,
    displayName: me.displayName,
    status: "active",
  };

  const renderRow = (slot: PlayerSlot, tag?: string) => {
    const selected = selectedUids.includes(slot.uid);
    return (
      <Pressable
        key={slot.uid}
        onPress={() => onToggle(slot)}
        style={{
          padding: 12,
          borderWidth: 1,
          borderRadius: 10,
          borderColor: selected ? "#333" : "#ddd",
          backgroundColor: selected ? "#eaeaea" : "white",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 16 }}>{slot.displayName}</Text>
          {tag && (
            <Text style={{ fontSize: 11, color: "#aaa", fontWeight: "500" }}>
              {tag}
            </Text>
          )}
        </View>
        <Text style={{ color: "#555" }}>{selected ? "✓" : ""}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: 8 }}>
      {/* You */}
      <Text style={{ fontSize: 12, fontWeight: "700", color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5 }}>
        You
      </Text>
      {renderRow(meSlot)}

      {/* Your guests */}
      {guests.length > 0 && (
        <>
          <Text style={{ fontSize: 12, fontWeight: "700", color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>
            Your Guests
          </Text>
          {guests.map((g) =>
            renderRow(
              {
                type: "guest",
                uid: g.id,
                ownerUid: g.ownerUid,
                ownerDisplayName: me.displayName,
                displayName: g.name,
                status: "active",
              }
            )
          )}
        </>
      )}
    </View>
  );
}
