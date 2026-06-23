/**
 * Tipografie semantica.
 * Space Grotesk = display/titluri. Inter = corp. JetBrains Mono = date tehnice
 * (fingerprint, DID, safety number).
 */
import { TextStyle } from "react-native";
import { colors } from "./tokens";

export const fonts = {
  display: "SpaceGrotesk_600SemiBold",
  displayBold: "SpaceGrotesk_700Bold",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemibold: "Inter_600SemiBold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const;

export const type = {
  h1: {
    fontFamily: fonts.displayBold,
    fontSize: 30,
    lineHeight: 36,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  } as TextStyle,
  h2: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 28,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  } as TextStyle,
  h3: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
  } as TextStyle,
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textPrimary,
  } as TextStyle,
  bodyMuted: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  } as TextStyle,
  label: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    lineHeight: 16,
    color: colors.textSecondary,
    letterSpacing: 0.2,
  } as TextStyle,
  caption: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 15,
    color: colors.textMuted,
  } as TextStyle,
  mono: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    letterSpacing: 0.4,
  } as TextStyle,
  monoHi: {
    fontFamily: fonts.monoMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.primary,
    letterSpacing: 0.6,
  } as TextStyle,
} as const;
