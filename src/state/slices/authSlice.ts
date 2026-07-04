/** Slice identitate + onboarding (Faza 3.1). */
import { AuthSlice, Slice } from "../types";

export const createAuthSlice: Slice<AuthSlice> = (set) => ({
  onboarded: false,
  identity: null,
  setOnboarded: (v) => set({ onboarded: v }),
  setIdentity: (identity) => set({ identity }),
});
