import Constants from "expo-constants";

/**
 * Verificare de update pentru build-uri sideload (APK direct, nu Play Store → fără
 * auto-update). Compară versiunea instalată cu ultimul release de pe GitHub și, dacă
 * e una mai nouă, întoarce link-ul APK-ului ca utilizatorul să-l descarce + instaleze.
 * Zero infrastructură nouă, zero telemetrie: doar un GET la API-ul public GitHub.
 */
const REPO = "tralalananala-cloud/blink";
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

export type UpdateInfo = { version: string; url: string };

function parseVer(v: string): number[] {
  return v.replace(/^v/i, "").split(".").map((x) => parseInt(x, 10) || 0);
}

/** semver simplu: e `remote` strict mai nou decât `local`? */
export function isNewer(remote: string, local: string): boolean {
  const r = parseVer(remote);
  const l = parseVer(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] || 0;
    const b = l[i] || 0;
    if (a !== b) return a > b;
  }
  return false;
}

export function currentVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const local = currentVersion();
  try {
    const res = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const j: any = await res.json();
    const tag: string = j.tag_name ?? "";
    if (!tag || !isNewer(tag, local)) return null;
    const assets: any[] = Array.isArray(j.assets) ? j.assets : [];
    // preferă APK-ul arm64 (majoritatea telefoanelor), altfel orice APK, altfel pagina release-ului
    const apk =
      assets.find((a) => /arm64.*\.apk$/i.test(a?.name || "")) ||
      assets.find((a) => /\.apk$/i.test(a?.name || ""));
    const url = apk?.browser_download_url || j.html_url;
    if (!url) return null;
    return { version: tag.replace(/^v/i, ""), url };
  } catch {
    return null; // offline / rate-limit / parse — eșuează silențios, fără a deranja userul
  }
}
