import { View, Text } from "react-native";
import { avatarColorFor, getInitials } from "../utils/designSystem";

interface AvatarCircleProps {
  /** uid for authenticated users; guest id for guests */
  uid: string;
  displayName: string;
  /** Diameter in px — defaults to 36 */
  size?: number;
  /** Guest avatars render with a dashed border and muted background */
  guest?: boolean;
}

/**
 * Renders a coloured initials circle.
 * - Authenticated: solid fill using the avatar palette colour.
 * - Guest: transparent background with a dashed border in the palette colour.
 */
export function AvatarCircle({ uid, displayName, size = 36, guest = false }: AvatarCircleProps) {
  const color = avatarColorFor(uid);
  const initials = getInitials(displayName);
  const fontSize = Math.round(size * 0.36);

  if (guest) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color.bg + "22", // 13% opacity tint
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: color.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize, fontWeight: "600", color: color.bg, letterSpacing: 0.3 }}>
          {initials}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize, fontWeight: "600", color: color.text, letterSpacing: 0.3 }}>
        {initials}
      </Text>
    </View>
  );
}
