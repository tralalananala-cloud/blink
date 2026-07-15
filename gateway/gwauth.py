"""Gateway auth (challenge-response) — PURE, an exact mirror of the relay scheme
(cf-worker/src/auth.mjs): DID = "did:key:z6Mk" + base32(sha256(idKey ‖ authPub))[:40],
Ed25519 signature (authPriv) over the UTF-8 nonce. Fail-closed: any error → False."""
import base64, hashlib
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

B32 = "abcdefghijklmnopqrstuvwxyz234567"

def b32(b: bytes) -> str:
    bits = val = 0
    out = []
    for byte in b:
        val = (val << 8) | byte
        bits += 8
        while bits >= 5:
            out.append(B32[(val >> (bits - 5)) & 31])
            bits -= 5
    if bits:
        out.append(B32[(val << (5 - bits)) & 31])
    return "".join(out)

def b64d(s: str) -> bytes:
    s = str(s).replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))

def did_from_keys(id_key_b64: str, auth_pub_b64: str) -> str:
    dig = hashlib.sha256(b64d(id_key_b64) + b64d(auth_pub_b64)).digest()
    return "did:key:z6Mk" + b32(dig)[:40]

def verify_reg(did, id_key_b64, auth_pub_b64, sig_b64, nonce) -> bool:
    try:
        if not (did and id_key_b64 and auth_pub_b64 and sig_b64 and nonce):
            return False
        if did_from_keys(id_key_b64, auth_pub_b64) != did:
            return False
        Ed25519PublicKey.from_public_bytes(b64d(auth_pub_b64)).verify(b64d(sig_b64), str(nonce).encode())
        return True
    except Exception:
        return False
