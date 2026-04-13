// ── Design system — colours, spacing, avatar helpers ─────────────────────────

export const C = {
  // Brand (banana yellow)
  brand:       "#F5C842",
  brandShadow: "#D4A820",
  brandText:   "#4A3800",

  // App background + surfaces (dark theme)
  bg:              "#30302E",
  surface:         "#30302E",
  surfaceSecondary:"#3A3A38",

  // Text hierarchy
  textPrimary:   "#F0F0F0",
  textSecondary: "#AAAAAA",
  textTertiary:  "#666666",

  // Borders
  border:         "#4A4A47",
  borderTertiary: "#3D3D3B",

  // Info / action blue
  info:   "#2F7FE3",
  infoBg: "#EBF3FC",

  // Success green
  success:    "#3D9B4D",
  successBg:  "#E8F5E9",
  successText:"#1B5E20",

  // Danger red
  danger:       "#501313",
  dangerBg:     "#F09595",
  dangerBorder: "#E57373",

  // Warning / amber
  warning:     "#D4A820",
  warningBg:   "#FFF8E1",
  warningText: "#5D4037",

  // Border radius
  radiusSm:   8,
  radiusMd:   12,
  radiusLg:   16,
  radiusFull: 99,

  // Avatar palette — 7 preset colours from the design spec
  avatarPalette: [
    { bg: "#85B7EB", text: "#042C53" }, // Blue
    { bg: "#97C459", text: "#173404" }, // Green
    { bg: "#F0997B", text: "#4A1B0C" }, // Coral
    { bg: "#AFA9EC", text: "#26215C" }, // Purple
    { bg: "#ED93B1", text: "#4B1528" }, // Pink
    { bg: "#FAC775", text: "#412402" }, // Amber
    { bg: "#B4B2A9", text: "#2C2C2A" }, // Gray
  ] as const,
} as const;

/** Derive a stable avatar colour from a uid or guest id. */
export function avatarColorFor(seed: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return C.avatarPalette[hash % C.avatarPalette.length];
}

/**
 * Get 2-letter initials from a display name.
 * "Jane Doe" → "JD", "Alice" → "AL"
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
