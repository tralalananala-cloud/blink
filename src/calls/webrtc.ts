/**
 * Apeluri audio/video (Faza 5) peste WebRTC. Semnalizarea (offer/answer/ICE) trece
 * CRIPTATĂ E2E prin releu — releul nu vede media (P2P) și nici conținutul semnalizării.
 *
 * ⚠️ FUNDAȚIE: necesită modul nativ (react-native-webrtc) + test pe 2 device-uri.
 * STUN public acoperă multe NAT-uri; NAT simetric (mobil↔mobil) cere TURN (vezi config).
 *
 * webrtc.ts e standalone (nu importă relay) — relay îl cablează prin setSignalSender +
 * rutează semnalele primite către handleSignal (evită importul circular).
 */
import { Platform } from "react-native";
import type { RTCPeerConnection, MediaStream } from "react-native-webrtc";
import { fetchIceServers } from "../config";

// react-native-webrtc = modul NATIV → lazy, ca să nu crape web/Electron la pornire.
const isWeb = Platform.OS === "web";
function W(): any { return require("react-native-webrtc"); }

export type CallState = "idle" | "calling" | "ringing" | "connected" | "ended";
type Signal =
  | { sub: "offer"; sdp: string; video: boolean }
  | { sub: "answer"; sdp: string }
  | { sub: "ice"; candidate: any }
  | { sub: "end" };

type Listener = () => void;

class CallManager {
  private pc: RTCPeerConnection | null = null;
  private send: ((peerDid: string, sig: Signal) => void) | null = null;
  private listeners = new Set<Listener>();
  // Buffering ICE: candidații sosiți înainte de setRemoteDescription trebuie puși în coadă,
  // altfel addIceCandidate aruncă și candidatul se pierde → apelul nu se conectează.
  private remoteSet = false;
  private pendingIce: any[] = [];

  peerDid: string | null = null;
  state: CallState = "idle";
  video = false;
  incoming = false;
  localStream: MediaStream | null = null;
  remoteStream: MediaStream | null = null;

  /** Releul setează cum se trimit semnalele (criptate E2E). */
  setSignalSender(fn: (peerDid: string, sig: Signal) => void) { this.send = fn; }
  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  private emit() { this.listeners.forEach((l) => l()); }
  private set(s: Partial<Pick<CallManager, "state" | "video" | "incoming" | "peerDid">>) {
    Object.assign(this, s); this.emit();
  }

  // Adaugă un candidat ICE acum (dacă remote description e setat) sau îl pune în coadă.
  private async addIce(candidate: any) {
    const { RTCIceCandidate } = W();
    if (this.remoteSet && this.pc) {
      try { await this.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    } else {
      this.pendingIce.push(candidate);
    }
  }
  // După setRemoteDescription: golește coada de candidați acumulați.
  private async flushIce() {
    const { RTCIceCandidate } = W();
    this.remoteSet = true;
    const queued = this.pendingIce; this.pendingIce = [];
    for (const c of queued) { try { await this.pc?.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
  }

  private newPc(iceServers: any[]): RTCPeerConnection {
    this.remoteSet = false;
    this.pendingIce = [];
    const { RTCPeerConnection } = W();
    const pc: RTCPeerConnection = new RTCPeerConnection({ iceServers });
    (pc as any).onicecandidate = (e: any) => {
      if (e.candidate && this.peerDid) this.send?.(this.peerDid, { sub: "ice", candidate: e.candidate });
    };
    (pc as any).ontrack = (e: any) => { this.remoteStream = e.streams[0]; this.emit(); };
    (pc as any).onconnectionstatechange = () => {
      const st = (pc as any).connectionState;
      if (st === "connected") this.set({ state: "connected" });
      else if (st === "failed" || st === "disconnected" || st === "closed") this.cleanup("ended");
    };
    return pc;
  }

  private async getMedia(video: boolean): Promise<MediaStream> {
    const s = await W().mediaDevices.getUserMedia({ audio: true, video });
    this.localStream = s as MediaStream;
    return s as MediaStream;
  }

  /** Inițiază un apel către peer. */
  async startCall(peerDid: string, video: boolean): Promise<void> {
    if (isWeb) return; // apelurile WebRTC = doar nativ (desktop = fără modul nativ)
    this.set({ peerDid, video, incoming: false, state: "calling" });
    this.pc = this.newPc(await fetchIceServers()); // STUN + TURN (Cloudflare) pt date mobile
    const stream = await this.getMedia(video);
    stream.getTracks().forEach((t) => this.pc!.addTrack(t, stream));
    const offer = await this.pc.createOffer({});
    await this.pc.setLocalDescription(offer);
    this.send?.(peerDid, { sub: "offer", sdp: offer.sdp!, video });
  }

  /** Răspunde la un apel primit (după ce userul acceptă). */
  async accept(): Promise<void> {
    if (!this.pc || !this.peerDid) return;
    const stream = await this.getMedia(this.video);
    stream.getTracks().forEach((t) => this.pc!.addTrack(t, stream));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.send?.(this.peerDid, { sub: "answer", sdp: answer.sdp! });
    this.set({ state: "connected" });
  }

  /** Termină / refuză apelul. */
  hangup(): void {
    if (this.peerDid) this.send?.(this.peerDid, { sub: "end" });
    this.cleanup("ended");
  }

  private cleanup(state: CallState) {
    try { this.localStream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { this.pc?.close(); } catch {}
    this.pc = null; this.localStream = null; this.remoteStream = null;
    this.remoteSet = false; this.pendingIce = [];
    this.set({ state, incoming: false });
    setTimeout(() => { if (this.state === "ended") this.set({ state: "idle", peerDid: null }); }, 400);
  }

  /** Semnal primit de la peer (rutat de relay după decriptare E2E). */
  async handleSignal(fromDid: string, sig: Signal): Promise<void> {
    if (isWeb) return; // desktop nu poate participa la apeluri (fără modul nativ)
    const { RTCSessionDescription } = W();
    if (sig.sub === "offer") {
      this.set({ peerDid: fromDid, video: sig.video, incoming: true, state: "ringing" });
      this.pc = this.newPc(await fetchIceServers());
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: sig.sdp }));
      await this.flushIce(); // candidați sosiți cât descărcam offer-ul
    } else if (sig.sub === "answer") {
      await this.pc?.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: sig.sdp }));
      await this.flushIce();
    } else if (sig.sub === "ice") {
      await this.addIce(sig.candidate);
    } else if (sig.sub === "end") {
      this.cleanup("ended");
    }
  }
}

export const callManager = new CallManager();
