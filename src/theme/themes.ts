/**
 * Trei teme comutabile runtime. Fiecare respectă ACELAȘI shape (ThemeColors),
 * ca să poată fi schimbată dintr-un singur loc (ThemeProvider).
 * - cipher: cypherpunk dark (originalul)
 * - messenger: stil Meta Messenger (light, bule albastre)
 * - telegram: stil Telegram (light, bule verzi-deschis)
 */

export interface ThemeColors {
  bg: string;
  bgRaised: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderSoft: string;

  primary: string;
  primaryDim: string;
  onPrimary: string;

  accent: string;
  accentDim: string;

  secure: string;
  secureDim: string;

  warning: string;
  danger: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  glowPrimary: string;
  glowAccent: string;
  glowDanger: string;

  meshA: string;
  meshB: string;
  meshC: string;

  // bule de mesaj (per temă, ca să arate autentic)
  bubbleMine: string;
  bubbleMineText: string;
  bubbleTheirs: string;
  bubbleTheirsText: string;
  bubbleTheirsBorder: string;
  /** Gradient pe bula proprie (ex. Messenger). Dacă lipsește, se folosește bubbleMine solid. */
  bubbleMineGradient?: string[];

  // intensitatea glow-ului (0 = fără, pe temele light)
  glowOn: boolean;
}

export const cipherTheme: ThemeColors = {
  bg: "#0A0C10",
  bgRaised: "#12151C",
  surface: "#181C25",
  surfaceAlt: "#1F2430",
  border: "#232A38",
  borderSoft: "#1A2030",
  primary: "#B6FF3A",
  primaryDim: "#86C42B",
  onPrimary: "#0A0C10",
  accent: "#35D0FF",
  accentDim: "#1F8FB8",
  secure: "#36E07F",
  secureDim: "#1F9D57",
  warning: "#F5B93C",
  danger: "#FF5765",
  textPrimary: "#ECEFF4",
  textSecondary: "#A7B0C0",
  textMuted: "#5E6878",
  glowPrimary: "rgba(182,255,58,0.35)",
  glowAccent: "rgba(53,208,255,0.30)",
  glowDanger: "rgba(255,87,101,0.28)",
  meshA: "#10261B",
  meshB: "#0C1A28",
  meshC: "#0A0C10",
  bubbleMine: "#B6FF3A",
  bubbleMineText: "#0A0C10",
  bubbleTheirs: "#181C25",
  bubbleTheirsText: "#ECEFF4",
  bubbleTheirsBorder: "#232A38",
  glowOn: true,
};

export const messengerTheme: ThemeColors = {
  bg: "#FFFFFF",
  bgRaised: "#FFFFFF",
  surface: "#F0F2F5",
  surfaceAlt: "#E4E6EB",
  border: "#E4E6EB",
  borderSoft: "#F0F2F5",
  primary: "#0A7CFF",
  primaryDim: "#0866FF",
  onPrimary: "#FFFFFF",
  accent: "#0A7CFF",
  accentDim: "#0866FF",
  secure: "#31A24C",
  secureDim: "#1B7F37",
  warning: "#F7B928",
  danger: "#FA383E",
  textPrimary: "#050505",
  textSecondary: "#65676B",
  textMuted: "#8A8D91",
  glowPrimary: "rgba(10,124,255,0.18)",
  glowAccent: "rgba(10,124,255,0.18)",
  glowDanger: "rgba(250,56,62,0.18)",
  meshA: "#FFFFFF",
  meshB: "#FFFFFF",
  meshC: "#FFFFFF",
  bubbleMine: "#0A7CFF",
  bubbleMineText: "#FFFFFF",
  bubbleTheirs: "#E4E6EB",
  bubbleTheirsText: "#050505",
  bubbleTheirsBorder: "#E4E6EB",
  glowOn: false,
};

export const telegramTheme: ThemeColors = {
  bg: "#FFFFFF",
  bgRaised: "#FFFFFF",
  surface: "#F4F4F5",
  surfaceAlt: "#EDEDED",
  border: "#E6ECF0",
  borderSoft: "#F0F0F0",
  primary: "#40A7E3",
  primaryDim: "#2E8BC7",
  onPrimary: "#FFFFFF",
  accent: "#40A7E3",
  accentDim: "#2E8BC7",
  secure: "#4DCD5E",
  secureDim: "#34A546",
  warning: "#E8A33D",
  danger: "#E1474D",
  textPrimary: "#000000",
  textSecondary: "#707579",
  textMuted: "#A8A8A8",
  glowPrimary: "rgba(64,167,227,0.16)",
  glowAccent: "rgba(64,167,227,0.16)",
  glowDanger: "rgba(225,71,77,0.16)",
  // fundal de chat bluish, ca Telegram
  meshA: "#DCE6EF",
  meshB: "#C9DCEA",
  meshC: "#D7E3ED",
  bubbleMine: "#EFFDDE",
  bubbleMineText: "#000000",
  bubbleTheirs: "#FFFFFF",
  bubbleTheirsText: "#000000",
  bubbleTheirsBorder: "#E6ECF0",
  glowOn: false,
};

// Telegram DARK — fundal navy, albastru Telegram, bule întunecate (screenshot 1).
export const abyssTheme: ThemeColors = {
  bg: "#0E1621",
  bgRaised: "#17212B",
  surface: "#182533",
  surfaceAlt: "#1F2C3A",
  border: "#101921",
  borderSoft: "#16222E",
  primary: "#3390EC",
  primaryDim: "#2B7FD3",
  onPrimary: "#FFFFFF",
  accent: "#3390EC",
  accentDim: "#2B7FD3",
  secure: "#4FAE4E",
  secureDim: "#3C8A3B",
  warning: "#E5A93D",
  danger: "#E5544B",
  textPrimary: "#FFFFFF",
  textSecondary: "#7D8E9E",
  textMuted: "#5E6E7E",
  glowPrimary: "rgba(51,144,236,0.16)",
  glowAccent: "rgba(51,144,236,0.16)",
  glowDanger: "rgba(229,84,75,0.16)",
  // navy ușor variat pentru senzația de fundal cu pattern
  meshA: "#131D29",
  meshB: "#0C141E",
  meshC: "#0E1621",
  bubbleMine: "#2B5278",
  bubbleMineText: "#FFFFFF",
  bubbleTheirs: "#182533",
  bubbleTheirsText: "#FFFFFF",
  bubbleTheirsBorder: "#1F2C3A",
  glowOn: false,
};

// Messenger DARK — negru pur, bule primite gri, bula proprie cu gradient (screenshot 2).
export const nebulaTheme: ThemeColors = {
  bg: "#000000",
  bgRaised: "#000000",
  surface: "#303030",
  surfaceAlt: "#3A3B3C",
  border: "#2A2A2A",
  borderSoft: "#1C1C1C",
  primary: "#0A7CFF",
  primaryDim: "#0866FF",
  onPrimary: "#FFFFFF",
  accent: "#A64BF4",
  accentDim: "#8A3BD0",
  secure: "#31A24C",
  secureDim: "#1B7F37",
  warning: "#F7B928",
  danger: "#FF4D67",
  textPrimary: "#FFFFFF",
  textSecondary: "#B0B3B8",
  textMuted: "#8A8D91",
  glowPrimary: "rgba(166,75,244,0.20)",
  glowAccent: "rgba(166,75,244,0.20)",
  glowDanger: "rgba(255,77,103,0.18)",
  meshA: "#000000",
  meshB: "#000000",
  meshC: "#000000",
  bubbleMine: "#A64BF4",
  bubbleMineText: "#FFFFFF",
  bubbleMineGradient: ["#F24FE0", "#A64BF4", "#5C73F5"], // magenta → mov → albastru
  bubbleTheirs: "#303030",
  bubbleTheirsText: "#FFFFFF",
  bubbleTheirsBorder: "#303030",
  glowOn: false,
};

export type ThemeName = "cipher" | "messenger" | "telegram" | "abyss" | "nebula";

/** Familia de UI dictează iconițele/butoanele (header + composer). */
export type ThemeFamily = "cipher" | "telegram" | "messenger";

export const themes: Record<ThemeName, { label: string; dark: boolean; family: ThemeFamily; colors: ThemeColors }> = {
  cipher: { label: "Blink", dark: true, family: "cipher", colors: cipherTheme },
  messenger: { label: "Cobalt", dark: false, family: "messenger", colors: messengerTheme },
  telegram: { label: "Mint", dark: false, family: "telegram", colors: telegramTheme },
  abyss: { label: "Abyss", dark: true, family: "telegram", colors: abyssTheme },
  nebula: { label: "Nebula", dark: true, family: "messenger", colors: nebulaTheme },
};
