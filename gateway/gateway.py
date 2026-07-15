#!/usr/bin/env python3
"""
Blink ↔ Reticulum gateway (bidirectional, blind transport) — the server half of the integration.
Each Blink user maps to one Reticulum identity/address. The gateway carries ONLY opaque blobs
(libsignal envelopes) — it never sees message content.

HTTP API (the Blink app uses it):
  POST /register {did}                          → {nonce}        step 1: challenge
  POST /register {did, idKey, authPub, sig}     → {addr, token}  step 2: signature over the nonce
                                                                  (Ed25519 + DID binding, gwauth)
  POST /send {to, blob}         → {ok}           send an OPAQUE blob to Reticulum address `to`
  GET  /recv?addr=<hex>&token=  → {msgs:[]}      take (and empty) the inbox — token required
  GET  /health                  → {ok, users}

Security: /register requires proof of DID ownership (same scheme as the relay — signChallenge
over the nonce + DID = base32(sha256(idKey‖authPub))) → nobody can claim someone else's DID.
The inbox token (persisted per DID) stops third parties who learn the address from draining it.

Configuration (environment variables):
  GW_PORT           HTTP port (default 8090, bound to 127.0.0.1)
  GW_STORE          state directory (identities, tokens) — default ~/.blink-gateway
  GW_RNS_CONFIGDIR  Reticulum config dir — default None (shared instance)
"""
import os, json, secrets, threading, time, RNS, LXMF
from gwauth import verify_reg
from http.server import BaseHTTPRequestHandler, HTTPServer

# Per-instance parameters (a federation can run several independent gateways).
PORT = int(os.environ.get("GW_PORT", "8090"))
STORE = os.environ.get("GW_STORE") or os.path.expanduser("~/.blink-gateway")
RNS_CONFIGDIR = os.environ.get("GW_RNS_CONFIGDIR") or None  # None = shared instance
os.makedirs(STORE, exist_ok=True)
INBOX_CAP = 200  # blobs per address — beyond this, the oldest fall off (anti RAM bloat)
TOKENS_FILE = os.path.join(STORE, "gateway_tokens.json")
RNS.Reticulum(configdir=RNS_CONFIGDIR)

lock = threading.Lock()
users = {}   # did -> {"router","dest","addr"}
inbox = {}   # addr_hex -> [blob,...]
try:
    with open(TOKENS_FILE) as f: tokens = json.load(f)  # did -> token (persists across restart)
except Exception:
    tokens = {}

def token_for(did):
    if did not in tokens:
        tokens[did] = secrets.token_hex(16)
        with open(TOKENS_FILE, "w") as f: json.dump(tokens, f)
    return tokens[did]

NONCE_TTL = 60
nonces = {}  # did -> (nonce, expires_at) — in-flight challenges (step 1 → step 2)

def load_or_new(name):
    p = os.path.join(STORE, name)
    if os.path.exists(p): return RNS.Identity.from_file(p)
    i = RNS.Identity(); i.to_file(p); return i

# send router (source for LXMessage; the real sender is inside the encrypted blob)
gw_send_router = LXMF.LXMRouter(storagepath=os.path.join(STORE, "lxmf_gw_send"))
gw_send_dest = gw_send_router.register_delivery_identity(load_or_new("id_gateway"), display_name="gw")

def _cb(addr_hex):
    def cb(msg):
        with lock:
            box = inbox.setdefault(addr_hex, [])
            box.append(msg.content_as_string())
            del box[:-INBOX_CAP]  # cap against bloat
        print("[gateway] INBOX +1 →", addr_hex[:16], "|", len(msg.content_as_string()), "opaque bytes", flush=True)
    return cb

def register(did):
    with lock:
        if did in users: return users[did]["addr"]
    safe = "".join(c for c in did if c.isalnum())[-24:]
    identity = load_or_new("id_user_" + safe)
    router = LXMF.LXMRouter(storagepath=os.path.join(STORE, "lxmf_user_" + safe))
    dest = router.register_delivery_identity(identity, display_name="blink:" + safe[:8])
    addr = dest.hash.hex()
    router.register_delivery_callback(_cb(addr))
    dest.announce()
    with lock: users[did] = {"router": router, "dest": dest, "addr": addr}
    print("[gateway] REGISTER", did[:20], "→", addr[:16], flush=True)
    return addr

def send_blob(to_hex, blob):
    # Local shortcut: the recipient is a user of THIS gateway → straight into the inbox, without
    # going out on the network (two users on the same gateway; in-process LXMF delivery loops).
    with lock:
        if any(u["addr"] == to_hex for u in users.values()):
            box = inbox.setdefault(to_hex, [])
            box.append(blob)
            del box[:-INBOX_CAP]
            print("[gateway] LOCAL →", to_hex[:16], "|", len(blob), "opaque bytes", flush=True)
            return
    to_hash = bytes.fromhex(to_hex)
    if not RNS.Transport.has_path(to_hash):
        RNS.Transport.request_path(to_hash)
        for _ in range(10):
            if RNS.Transport.has_path(to_hash): break
            time.sleep(0.5)
    rid = RNS.Identity.recall(to_hash)
    if not rid: raise RuntimeError("unknown identity for " + to_hex[:16])
    recipient = RNS.Destination(rid, RNS.Destination.OUT, RNS.Destination.SINGLE, "lxmf", "delivery")
    lxm = LXMF.LXMessage(recipient, gw_send_dest, blob, "blink", desired_method=LXMF.LXMessage.OPPORTUNISTIC)
    gw_send_router.handle_outbound(lxm)
    print("[gateway] CARRIED OPAQUE →", to_hex[:16], "|", len(blob), "bytes | content UNSEEN", flush=True)

class H(BaseHTTPRequestHandler):
    def _j(self, c, o): self.send_response(c); self.send_header("content-type","application/json"); self.end_headers(); self.wfile.write(json.dumps(o).encode())
    def log_message(self, *a): pass
    def _body(self):
        n = int(self.headers.get("content-length", 0)); return json.loads(self.rfile.read(n) or b"{}")
    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        u = urlparse(self.path)
        if u.path == "/health":
            with lock: n = len(users)
            return self._j(200, {"ok": True, "users": n})
        if u.path == "/recv":
            q = parse_qs(u.query)
            addr = (q.get("addr") or [""])[0]
            tok = (q.get("token") or [""])[0]
            # the inbox is emptied ONLY with the token of the DID that owns the address
            with lock:
                did = next((d for d, uu in users.items() if uu["addr"] == addr), None)
            if not did or not tok or not secrets.compare_digest(tokens.get(did, ""), tok):
                return self._j(403, {"err": "bad token"})
            with lock: msgs = inbox.pop(addr, [])
            return self._j(200, {"msgs": msgs})
        return self._j(404, {"err": "not found"})
    def do_POST(self):
        try:
            b = self._body()
            if self.path == "/register":
                did = b.get("did")
                if not did: return self._j(400, {"err": "missing did"})
                if not b.get("sig"):
                    # step 1: issue a challenge (nonce with TTL); the client signs it with the DID key
                    n = secrets.token_hex(16)
                    with lock: nonces[did] = (n, time.time() + NONCE_TTL)
                    return self._j(200, {"nonce": n})
                # step 2: verify the signature + DID binding (fail-closed); the nonce is consumed
                with lock: rec = nonces.pop(did, None)
                if not rec or rec[1] < time.time():
                    return self._j(403, {"err": "nonce missing/expired — redo step 1"})
                if not verify_reg(did, b.get("idKey"), b.get("authPub"), b.get("sig"), rec[0]):
                    print("[gateway] REGISTER REFUSED (invalid auth)", did[:20], flush=True)
                    return self._j(403, {"err": "invalid auth"})
                return self._j(200, {"addr": register(did), "token": token_for(did)})
            if self.path == "/send":
                if not b.get("to") or b.get("blob") is None: return self._j(400, {"err": "missing to/blob"})
                send_blob(b["to"], b["blob"]); return self._j(200, {"ok": True})
            return self._j(404, {"err": "not found"})
        except Exception as e:
            self._j(500, {"err": str(e)})

print("[gateway] bidirectional on HTTP :%d (store=%s, blind transport)" % (PORT, os.path.basename(STORE)), flush=True)
HTTPServer(("127.0.0.1", PORT), H).serve_forever()
