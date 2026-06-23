/**
 * Design tokens semantici — sursa unica de adevar pentru culori/spatiu/raze.
 * Estetica: cypherpunk dark-first. Niciun ecran nu hardcodeaza culori; folosesc
 * doar aceste tokenuri. Valorile oklch din brief sunt convertite la hex pentru
 * compatibilitate React Native.
 */

/** Paleta de baza (oklch -> hex aproximat). */
const palette = {
  // deep ink background ~ oklch(0.16 0.02 260)
  ink900: "#0A0C10",
  ink800: "#0E1117",
  ink700: "#12151C",
  ink600: "#181C25",
  ink500: "#1F2430",
  line: "#232A38",
  lineSoft: "#1A2030",

  // electric lime primary ~ oklch(0.88 0.22 130)
  lime: "#B6FF3A",
  limeDim: "#86C42B",
  limeGlow: "rgba(182,255,58,0.35)",

  // cyber blue accent ~ oklch(0.80 0.13 230)
  cyber: "#35D0FF",
  cyberDim: "#1F8FB8",
  cyberGlow: "rgba(53,208,255,0.30)",

  // secure green signal ~ oklch(0.82 0.17 150)
  secure: "#36E07F",
  secureDim: "#1F9D57",

  // states
  warn: "#F5B93C",
  danger: "#FF5765",
  dangerGlow: "rgba(255,87,101,0.28)",

  // text
  textHi: "#ECEFF4",
  textMid: "#A7B0C0",
  textLow: "#5E6878",

  white: "#FFFFFF",
  black: "#000000",
} as const;

/** Tokenuri SEMANTICE — astea se folosesc in cod, nu paleta direct. */
export const colors = {
  bg: palette.ink900,
  bgRaised: palette.ink700,
  surface: palette.ink600,
  surfaceAlt: palette.ink500,
  border: palette.line,
  borderSoft: palette.lineSoft,

  primary: palette.lime,
  primaryDim: palette.limeDim,
  onPrimary: palette.ink900,

  accent: palette.cyber,
  accentDim: palette.cyberDim,

  secure: palette.secure,
  secureDim: palette.secureDim,

  warning: palette.warn,
  danger: palette.danger,

  textPrimary: palette.textHi,
  textSecondary: palette.textMid,
  textMuted: palette.textLow,

  glowPrimary: palette.limeGlow,
  glowAccent: palette.cyberGlow,
  glowDanger: palette.dangerGlow,

  // mesh gradient stops (radial subtil pe fundal)
  meshA: "#10261B",
  meshB: "#0C1A28",
  meshC: palette.ink900,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  full: 999,
} as const;

/** Umbre cu "glow" pentru actiuni primare. */
export const glow = {
  primary: {
    shadowColor: colors.primary,
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  accent: {
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  none: {},
} as const;

export type Colors = typeof colors;
