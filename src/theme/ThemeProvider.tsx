import React, { createContext, useContext, useMemo } from "react";
import { TextStyle } from "react-native";
import { useApp } from "../state/store";
import { cipherTheme, ThemeColors, ThemeFamily, themes } from "./themes";
import { fonts } from "./typography";

interface ThemeCtx {
  colors: ThemeColors;
  name: string;
  dark: boolean;
  family: ThemeFamily;
}

const Ctx = createContext<ThemeCtx>({ colors: cipherTheme, name: "cipher", dark: true, family: "cipher" });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeName = useApp((s) => s.settings.themeName);
  const value = useMemo<ThemeCtx>(() => {
    const th = themes[themeName] ?? themes.cipher;
    return { colors: th.colors, name: themeName, dark: th.dark, family: th.family };
  }, [themeName]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}

/** Tipografie cu culorile temei aplicate. Înlocuiește importul static al `type`. */
export function useType() {
  const { colors } = useTheme();
  return useMemo(() => makeType(colors), [colors]);
}

export type TypeSet = ReturnType<typeof makeType>;

function makeType(c: ThemeColors) {
  return {
    h1: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 36, color: c.textPrimary, letterSpacing: -0.5 } as TextStyle,
    h2: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: c.textPrimary, letterSpacing: -0.3 } as TextStyle,
    h3: { fontFamily: fonts.display, fontSize: 17, lineHeight: 22, color: c.textPrimary } as TextStyle,
    body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: c.textPrimary } as TextStyle,
    bodyMuted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.textSecondary } as TextStyle,
    label: { fontFamily: fonts.bodySemibold, fontSize: 13, lineHeight: 16, color: c.textSecondary, letterSpacing: 0.2 } as TextStyle,
    caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 15, color: c.textMuted } as TextStyle,
    mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, color: c.textSecondary, letterSpacing: 0.4 } as TextStyle,
    monoHi: { fontFamily: fonts.monoMedium, fontSize: 14, lineHeight: 20, color: c.primary, letterSpacing: 0.6 } as TextStyle,
  };
}
