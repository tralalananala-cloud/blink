/** Opțiuni de auto-ștergere (burn-after-read) — partajate de header-ul conversației și ConvOptionsSheet. */
export const BURN_OPTIONS: { key: string; min: number; ms?: number }[] = [
  { key: "off", min: 0, ms: undefined },
  { key: "1", min: 1, ms: 60_000 },
  { key: "5", min: 5, ms: 5 * 60_000 },
  { key: "10", min: 10, ms: 10 * 60_000 },
  { key: "30", min: 30, ms: 30 * 60_000 },
  { key: "60", min: 60, ms: 60 * 60_000 },
  { key: "6h", min: 360, ms: 6 * 3600_000 },
  { key: "12h", min: 720, ms: 12 * 3600_000 },
];
export function burnLabel(o: { key: string; min: number }, off: string): string {
  if (o.key === "off") return off;
  if (o.min < 60) return `${o.min} min`;
  return `${o.min / 60} h`;
}
