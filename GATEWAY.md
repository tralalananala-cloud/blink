# Run your own Blink ↔ Reticulum gateway

Blink's **Reticulum transport** (experimental, off by default) routes messages through a *gateway*
instead of the default Cloudflare relay. The gateway is a small Python service that carries
**opaque libsignal envelopes only** — it never sees message content, who you are talking to at the
content level, or your keys. Running your own means this hop happens on a machine you control.

> This is opt-in and experimental. The default, best-tested path is still the blind relay. Use the
> gateway if you specifically want a transport that does not depend on Blink's relay.

## What the gateway does

- Each Blink user registers a DID and gets a Reticulum address. Registration is
  **challenge-response**: the gateway issues a nonce, the app signs it with the DID's key, and the
  gateway checks the signature **and** that `DID = base32(sha256(idKey ‖ authPub))`. Nobody can
  claim someone else's DID.
- `POST /send` carries an **opaque blob** (an already end-to-end-encrypted libsignal envelope) to a
  Reticulum address. The gateway cannot read it.
- `GET /recv` returns and empties a user's inbox — but only when presented the per-DID **token**
  handed out at registration, so a third party who learns your address still cannot drain it.
- `GET /health` returns `{ok, users}`.

The content is encrypted end-to-end **before** it reaches the gateway and stays encrypted after it.
The gateway is a dumb, blind pipe.

## Requirements

- **Python 3.9+**
- A machine that can reach the Reticulum network. Out of the box the gateway uses your shared
  Reticulum instance (`~/.reticulum`); configure interfaces there as you would for any RNS node
  (see the [Reticulum manual](https://reticulum.network/manual/)). No special interface = it uses
  whatever transport your RNS config provides.
- To let phones reach it, a **public HTTPS endpoint** in front of it (the gateway itself binds to
  `127.0.0.1` only — see "Exposing it" below).

## Start it

From a checkout of this repository:

```bash
scripts/run-gateway.sh
```

The first run creates a virtualenv at `~/.blink-gateway/venv`, installs the pinned dependencies
(`rns`, `lxmf`, `cryptography`), and starts the gateway on `127.0.0.1:8090`. State (Reticulum
identities and inbox tokens) is kept in `~/.blink-gateway`.

Check it:

```bash
curl -s http://127.0.0.1:8090/health
# {"ok": true, "users": 0}
```

Stop with `Ctrl-C`. Re-running reuses the same identities and tokens.

### Configuration

All optional, via environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `GW_PORT` | `8090` | HTTP port (always bound to `127.0.0.1`) |
| `GW_STORE` | `~/.blink-gateway` | State directory: Reticulum identities + inbox tokens |
| `GW_RNS_CONFIGDIR` | shared instance | Reticulum config directory |

## Exposing it to phones

The gateway listens on `127.0.0.1` on purpose — it does **not** put itself on the public internet.
Phones talk to it over **HTTPS**, so you put a TLS endpoint in front of it. Any reverse proxy or
tunnel works. A quick tunnel with `cloudflared`:

```bash
cloudflared tunnel --protocol http2 --url http://127.0.0.1:8090
```

This prints an `https://<random>.trycloudflare.com` URL. (Use a named tunnel or your own reverse
proxy — nginx/Caddy with a real certificate — for a stable address.)

> `--protocol http2` matters if your host blocks outbound QUIC/UDP; drop it otherwise.

## Point the app at your gateway

On the phone: **Settings → Transport → Reticulum**. Put your gateway's public HTTPS URL in the
gateway address field, then turn the Reticulum toggle on. Both correspondents should use a gateway
that can reach each other over Reticulum (the same gateway is simplest).

## Security notes

- The gateway sees **network metadata** (that address A sent an opaque blob to address B, sizes,
  timing) — it does not see content, sender identity at the content level, or keys. This is the
  same metadata trade-off as any relay; running your own just changes *who* holds it (you).
- `~/.blink-gateway` holds Reticulum **identity files** (`id_*`) and `gateway_tokens.json`. These
  are secrets for your instance — do not commit them or share them. They are not part of this
  repository.
- The gateway is part of the same AGPL-3.0 project. The auth scheme (`gateway/gwauth.py`) is an
  exact mirror of the relay's, so a gateway and the relay agree on what a valid DID is.
