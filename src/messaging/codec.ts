/**
 * Codecul protocolului de control E2E (Faza 3.2) — PUR: fără rețea, store sau cripto.
 * Plaintext-ul interior al fiecărui mesaj Blink e un mic JSON de control `{k:...}`:
 *   t  text · a  ack(bifă) · mh/mc  media(antet/bucată) · e  edit · d  del-msg · dc  del-conv · call  WebRTC
 *   gt  text de grup · gc  membership grup (fan-out pairwise: aceleași plicuri 1:1, doar alt {k})
 *
 * Encoderii (`ctl.*`) construiesc obiectul; apelantul îl serializează + criptează.
 * `parseControl` clasifică un plaintext PRIMIT într-un mesaj tipat (discriminated union),
 * reproducând exact dispecerizarea din relay.handle (inclusiv fallback-ul „peer vechi → text").
 * Testat direct (codec.test.ts) + indirect prin relay.wire.test.ts (gate: trec neschimbate).
 */

export type AckKind = "delivered" | "read";
export type GroupAct = "create" | "add" | "remove" | "leave";
const GROUP_ACTS: readonly string[] = ["create", "add", "remove", "leave"];
/** Cap membri per grup (fan-out pairwise = N trimiteri per mesaj; 16 ține costul onest). */
export const GROUP_MAX = 16;

// ── Encoderi (obiectul {k:...}; JSON.stringify + criptarea le face apelantul) ──
export const ctl = {
  text: (id: string, b: string, n: string, ra?: string) => ({ k: "t" as const, id, b, n, ra }),
  ack: (id: string, s: AckKind) => ({ k: "a" as const, id, s }),
  mediaHeader: (id: string, n: number, meta: any, gid?: string) => ({ k: "mh" as const, id, n, meta, gid }),
  mediaChunk: (id: string, i: number, d: string) => ({ k: "mc" as const, id, i, d }),
  edit: (id: string, b: string) => ({ k: "e" as const, id, b }),
  delMsg: (id: string) => ({ k: "d" as const, id }),
  delConv: () => ({ k: "dc" as const }),
  call: (sig: any) => ({ k: "call" as const, sig }),
  // Grup: gname călătorește pe fiecare gt/gc ca receptorul să poată auto-crea conversația
  // la primul mesaj (fan-out = nu există „server de grup" care să știe numele).
  groupText: (gid: string, id: string, b: string, n: string, gname?: string) =>
    ({ k: "gt" as const, gid, id, b, n, gname }),
  groupCtl: (gid: string, act: GroupAct, opts?: { members?: string[]; name?: string }) =>
    ({ k: "gc" as const, gid, act, members: opts?.members, name: opts?.name }),
};

// ── Parser: plaintext primit → mesaj de control tipat ──
export type Control =
  | { k: "a"; id: string; s: AckKind }
  | { k: "e"; id: string; b: string }
  | { k: "d"; id: string }
  | { k: "dc" }
  | { k: "call"; sig: any }
  | { k: "mh"; id: string; n: number; meta: any; gid?: string }
  | { k: "mc"; id: string; i: number; d: string }
  | { k: "gt"; gid: string; id: string; b: string; n?: string; gname?: string }
  | { k: "gc"; gid: string; act: GroupAct; members?: string[]; name?: string }
  | { k: "t"; id?: string; b?: string; n?: string; ra?: string }
  | { k: "raw"; b: string }; // plaintext ne-JSON sau {k} necunoscut → tratat ca text simplu (peer vechi)

/**
 * Clasifică plaintext-ul. Gărzile pe câmpuri (`&& id`) și ordinea sunt IDENTICE cu vechiul
 * `handle`: un control căruia îi lipsesc câmpurile cheie cade pe ramura „raw" (text), nu crapă.
 */
export function parseControl(plaintext: string): Control {
  let p: any = null;
  try { p = JSON.parse(plaintext); } catch { /* ne-JSON → raw */ }
  if (p && p.k === "a" && p.id) return { k: "a", id: p.id, s: p.s === "read" ? "read" : "delivered" };
  if (p && p.k === "e" && p.id) return { k: "e", id: p.id, b: p.b ?? "" };
  if (p && p.k === "d" && p.id) return { k: "d", id: p.id };
  if (p && p.k === "dc") return { k: "dc" };
  if (p && p.k === "call" && p.sig) return { k: "call", sig: p.sig };
  if (p && p.k === "mh" && p.id) return { k: "mh", id: p.id, n: p.n, meta: p.meta || {}, gid: typeof p.gid === "string" ? p.gid : undefined };
  if (p && p.k === "mc" && p.id) return { k: "mc", id: p.id, i: p.i, d: p.d };
  if (p && p.k === "gt" && p.gid && p.id) return { k: "gt", gid: p.gid, id: p.id, b: p.b ?? "", n: p.n, gname: typeof p.gname === "string" ? p.gname : undefined };
  if (p && p.k === "gc" && p.gid && GROUP_ACTS.includes(p.act)) return { k: "gc", gid: p.gid, act: p.act, members: Array.isArray(p.members) ? p.members : undefined, name: typeof p.name === "string" ? p.name : undefined };
  if (p && p.k === "t") return { k: "t", id: p.id, b: p.b, n: p.n, ra: p.ra };
  return { k: "raw", b: plaintext };
}
