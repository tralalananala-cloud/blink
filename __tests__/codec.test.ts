/**
 * Faza 3.2 — codecul de control E2E pur (src/messaging/codec.ts), extras din relay.ts.
 * Encoderii produc {k:...}; parseControl clasifică un plaintext primit, cu fallback la „raw"
 * (text) pentru plaintext ne-JSON sau control cu câmpuri lipsă — exact ca vechiul handle.
 */
import { ctl, parseControl } from "../src/messaging/codec";

describe("encoderi ctl.*", () => {
  it("text / ack / edit / del / dc / call", () => {
    expect(ctl.text("m1", "salut", "Ana", "ra1")).toEqual({ k: "t", id: "m1", b: "salut", n: "Ana", ra: "ra1" });
    expect(ctl.ack("m1", "read")).toEqual({ k: "a", id: "m1", s: "read" });
    expect(ctl.edit("m1", "nou")).toEqual({ k: "e", id: "m1", b: "nou" });
    expect(ctl.delMsg("m1")).toEqual({ k: "d", id: "m1" });
    expect(ctl.delConv()).toEqual({ k: "dc" });
    expect(ctl.call({ type: "offer" })).toEqual({ k: "call", sig: { type: "offer" } });
  });
  it("media header / chunk", () => {
    expect(ctl.mediaHeader("x", 3, { kind: "image" })).toEqual({ k: "mh", id: "x", n: 3, meta: { kind: "image" } });
    expect(ctl.mediaChunk("x", 0, "DATA")).toEqual({ k: "mc", id: "x", i: 0, d: "DATA" });
  });
  it("text fără ra → ra undefined (cheia dispare la JSON.stringify)", () => {
    const o = ctl.text("m", "b", "N");
    expect(o.ra).toBeUndefined();
    expect(JSON.parse(JSON.stringify(o))).toEqual({ k: "t", id: "m", b: "b", n: "N" });
  });
});

describe("parseControl — round-trip cu encoderii", () => {
  const rt = (o: any) => parseControl(JSON.stringify(o));
  it("fiecare {k} se clasifică înapoi corect", () => {
    expect(rt(ctl.text("m", "buna", "Bob", "addr"))).toEqual({ k: "t", id: "m", b: "buna", n: "Bob", ra: "addr" });
    expect(rt(ctl.ack("m", "delivered"))).toEqual({ k: "a", id: "m", s: "delivered" });
    expect(rt(ctl.edit("m", "x"))).toEqual({ k: "e", id: "m", b: "x" });
    expect(rt(ctl.delMsg("m"))).toEqual({ k: "d", id: "m" });
    expect(rt(ctl.delConv())).toEqual({ k: "dc" });
    expect(rt(ctl.call({ s: 1 }))).toEqual({ k: "call", sig: { s: 1 } });
    expect(rt(ctl.mediaHeader("m", 2, { kind: "image" }))).toEqual({ k: "mh", id: "m", n: 2, meta: { kind: "image" } });
    expect(rt(ctl.mediaChunk("m", 1, "D"))).toEqual({ k: "mc", id: "m", i: 1, d: "D" });
  });
});

describe("parseControl — gărzi + fallback (ca în handle)", () => {
  it("ack fără s → delivered implicit", () => {
    expect(parseControl(JSON.stringify({ k: "a", id: "m" }))).toEqual({ k: "a", id: "m", s: "delivered" });
  });
  it("plaintext ne-JSON → raw (text simplu)", () => {
    expect(parseControl("doar text 🔐")).toEqual({ k: "raw", b: "doar text 🔐" });
  });
  it("{k} necunoscut → raw", () => {
    expect(parseControl(JSON.stringify({ k: "zzz", id: "m" }))).toEqual({ k: "raw", b: '{"k":"zzz","id":"m"}' });
  });
  it("control cu câmpuri cheie lipsă → raw (nu dispecerizează greșit)", () => {
    expect(parseControl(JSON.stringify({ k: "e" })).k).toBe("raw");   // edit fără id
    expect(parseControl(JSON.stringify({ k: "d" })).k).toBe("raw");   // del fără id
    expect(parseControl(JSON.stringify({ k: "mc", i: 0 })).k).toBe("raw"); // chunk fără id
    expect(parseControl(JSON.stringify({ k: "call" })).k).toBe("raw"); // call fără sig
  });
  it("edit cu b lipsă → b gol", () => {
    expect(parseControl(JSON.stringify({ k: "e", id: "m" }))).toEqual({ k: "e", id: "m", b: "" });
  });
});

describe("grup (gt/gc + gid pe media) — lot GRUPURI v1", () => {
  const rt = (o: any) => parseControl(JSON.stringify(o));
  it("groupText round-trip, cu și fără gname", () => {
    expect(rt(ctl.groupText("g1", "m1", "salut grup", "Ana", "Gașca")))
      .toEqual({ k: "gt", gid: "g1", id: "m1", b: "salut grup", n: "Ana", gname: "Gașca" });
    expect(rt(ctl.groupText("g1", "m2", "iar", "Ana")))
      .toEqual({ k: "gt", gid: "g1", id: "m2", b: "iar", n: "Ana" });
  });
  it("groupCtl round-trip pe fiecare act", () => {
    expect(rt(ctl.groupCtl("g1", "create", { members: ["didA", "didB"], name: "Gașca" })))
      .toEqual({ k: "gc", gid: "g1", act: "create", members: ["didA", "didB"], name: "Gașca" });
    expect(rt(ctl.groupCtl("g1", "add", { members: ["didC"] })))
      .toEqual({ k: "gc", gid: "g1", act: "add", members: ["didC"] });
    expect(rt(ctl.groupCtl("g1", "remove", { members: ["didB"] })))
      .toEqual({ k: "gc", gid: "g1", act: "remove", members: ["didB"] });
    expect(rt(ctl.groupCtl("g1", "leave"))).toEqual({ k: "gc", gid: "g1", act: "leave" });
  });
  it("mediaHeader cu gid round-trip; fără gid rămâne 1:1 (compat)", () => {
    expect(rt(ctl.mediaHeader("x", 3, { kind: "image" }, "g1")))
      .toEqual({ k: "mh", id: "x", n: 3, meta: { kind: "image" }, gid: "g1" });
    expect(rt(ctl.mediaHeader("x", 3, { kind: "image" })).k === "mh" && (rt(ctl.mediaHeader("x", 3, { kind: "image" })) as any).gid).toBeUndefined();
  });
  it("gărzi: gt/gc cu câmpuri cheie lipsă sau act necunoscut → raw", () => {
    expect(parseControl(JSON.stringify({ k: "gt", id: "m", b: "x" })).k).toBe("raw");      // gt fără gid
    expect(parseControl(JSON.stringify({ k: "gt", gid: "g" })).k).toBe("raw");             // gt fără id
    expect(parseControl(JSON.stringify({ k: "gc", gid: "g", act: "explode" })).k).toBe("raw"); // act necunoscut
    expect(parseControl(JSON.stringify({ k: "gc", act: "add" })).k).toBe("raw");           // gc fără gid
  });
  it("gc cu members ne-array sau name ne-string → câmpuri ignorate, nu crapă", () => {
    expect(rt({ k: "gc", gid: "g", act: "add", members: "didC", name: 7 }))
      .toEqual({ k: "gc", gid: "g", act: "add" });
  });
  it("gt cu b lipsă → b gol (ca la edit)", () => {
    expect(rt({ k: "gt", gid: "g", id: "m" })).toEqual({ k: "gt", gid: "g", id: "m", b: "" });
  });
});
