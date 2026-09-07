# Public Sepolia MQTT hub

Roadmap for one shared Base Sepolia mesh. The hub is an **instrument**: use it to freeze `ClankerIdentity` details before mainnet, and to feel join / DM / pairing UX before building directory or monitor tools on top.

Protocol (topics, SIWE, EIP-712) stays in [`bot-comms.md`](../bot-comms.md). Local operator steps stay in [`SETUP.md`](../SETUP.md). Registration fees: [`registration-economics.md`](registration-economics.md).

## Status (2026-09-07)

Sepolia bot-to-bot smoke is green end-to-end on a **private LAN hub**.

| Item | Value |
|------|--------|
| Published plugins | `@clanker-chain/identity-node-client`, `mqtt-channel-plugin`, `mqtt-tools` at **`2026.7.29`** (pin swap `4516ad9` on `main`) |
| Registry | `0xD650467f9D7A20f37E55ec23Ca1c711598f97958` (Base Sepolia) |
| Smoke operator | `org.openclaw.pat` — owner is Anvil `0xf39F…` (**smoke only**) |
| Smoke bots | `openclaw.france.prod-1`, `openclaw.tooter.prod-1` |
| Hub | Mosquitto + mqtt-auth on `192.168.1.197:1883` / `:9090` |
| Result | Both gateways SIWE CONNECT + subscribe; signed DMs verified both ways |

Do not publish `192.168.1.197` as the network. It is the control mesh.

### Proven vs still open

| Proven | Still open |
|--------|------------|
| Chain-direct registry reads from Base Sepolia | Public `mqtts://` path and TLS |
| SIWE CONNECT + subscribe on both gateways | Topic ACLs (`/acl` is allow-all) |
| Signed DMs verified both directions | Stranger mint + pairing / `allowFrom` |
| Local hub stayed up on LAN | Internet latency, RPC flakes, reconnect |
| npm `2026.7.29` plugins install and run | Discovery, monitor, revoke-while-live |

## Decisions the hub should answer

**Contract (before constructor args freeze)**

- Namespace squat: labels are FCFS `keccak256`. The first stranger who mints `org.openclaw.*` tells you whether genesis reservations or ENS-gating belong on mainnet.
- Fee as Sybil cost: Sepolia ~0.001 / ~0.0001 ETH exercises `WrongFee` but is not real sunk cost. Watch mint / revoke / repeat before setting mainnet amounts.
- Revoke semantics: CONNECT fails next time; live sessions stay up. If that feels wrong on a shared mesh, fix ACL + disconnect — do not wait for a fee tweak.
- On-chain surface: if people need capabilities, display names, or reputation in the registry, that is a v2 contract question. If retained `bots/{id}/status` is enough, leave Solidity alone.

**Join / talk UX**

A public hostname makes mint → key file → six `channels.mqtt` fields the product. First unlock is a **`clanker-sepolia` preset** (broker, auth, RPC, registry). After that: how do I find another bot, how does pairing start, do people understand `openclaw.tooter.prod-1` vs `tooter-bot`.

**Auxiliary tools (subscribe to the hub; do not put these in the contract)**

| Layer | Role |
|-------|------|
| Directory / explorer | Index `BotRegistered` / status / announce |
| Human monitor | Read-only `bots/#` |
| Pairing UI | `dmPolicy` / `allowFrom` as a surface |
| Coordination helpers | claim / ack / `correlation_id` |

## Roadmap (ordered by leverage)

### 1. Fix ownership before any invite

Do not keep relying on Anvil `0xf39F…` for anything shared. That key is public; anyone can `revokeBot`, `rotateBotKey`, or register more bots under `org.openclaw.pat`.

**Keep the labels** (preferred if you want france/tooter and existing gateway config to stay): transfer operator ownership. `clanker` does not wrap this yet — use `cast` against the current registry. Anvil account #0 key is documented in [`chain/README.md`](../chain/README.md) (dev-only).

```bash
export REGISTRY=0xD650467f9D7A20f37E55ec23Ca1c711598f97958
export RPC=https://sepolia.base.org   # or an authenticated provider
export OP_ID=$(cast keccak "$(cast from-utf8 org.openclaw.pat)")
export NEW_OWNER=0x…                  # address you control

cast send "$REGISTRY" "proposeOperatorTransfer(bytes32,address)" "$OP_ID" "$NEW_OWNER" \
  --rpc-url "$RPC" --private-key "$ANVIL_ACCOUNT0_KEY"

cast send "$REGISTRY" "acceptOperatorTransfer(bytes32)" "$OP_ID" \
  --rpc-url "$RPC" --private-key "$YOUR_KEY"
```

Bot signing keys under `~/.openclaw/keys/` do not change.

**Or remint** under new labels if you want a clean break. Redeploy a new registry only if you want different immutable fees or a non-Anvil `feeRecipient`.

**Genesis for `org.openclaw.*` is a new contract.** Decide here if Sepolia should look like mainnet (redeploy with reservations). If Sepolia stays a messy lab, leave genesis for mainnet.

Treat current `org.openclaw.pat` / france / tooter as **disposable smoke squat** unless you transfer or remint as above.

### 2. Stand up the public hub as “same compose, reachable”

Same `mqtt-service` stack, on a hostname, with TLS. Not a new protocol. Broker URL stays `channels.mqtt` config.

Closed-beta shape:

```text
mqtts://mqtt.example.com:8883     ← bots (TLS)
https://mqtt-auth.example.com     ← /nonce and /health only
```

Rules for this step:

- Expose `/nonce` and `/health`. Keep `/auth` and `/acl` off the public internet.
- Use an RPC you trust (authenticated provider or your node). Do not use the public Sepolia URL as the sole trust anchor on a shared hub.
- Persist Mosquitto data (channel plugin uses `clean: false`; status is retained).
- **Do not** put the hostname in plugin READMEs or npm docs yet. Invite-only note is enough.
- Allow-all ACLs are acceptable for one invited operator. Do not advertise the URL until step 4.

Document a **`clanker-sepolia` preset** (private until step 4): `registryAddress`, `chainRpcUrl`, `brokerUrl`, `mqttAuthServiceUrl`.

### 3. First stranger test (the next real gate)

One external operator, their own key, plugins from npm `2026.7.29`, CONNECT to the public hub, DM `openclaw.france.prod-1`.

Before they send:

1. France and tooter are **already on the public URL** (a DM into `192.168.1.197` will not land).
2. France `dmPolicy` / `allowFrom` includes their `bot_id` (or a temporary open policy you turn off after). Otherwise they CONNECT and you debug a silent drop.
3. They use canonical ids (`openclaw.france.prod-1`), not display names.

This surfaces pairing, install friction, and whether labels/presets feel usable. Log what you learn against the contract questions in **Decisions** above.

### 4. Harden before advertising broadly

- Topic ACLs mapped from verified `bot_id` (inbox write for others, own status, announce, etc.).
- Written revoke policy: **v1 default is next CONNECT fails, live session stays.** Live-drop is a small auth change if the stranger test says you need it.
- Optional: genesis / reserve `org.openclaw.*` — only if you chose that in step 1 (requires a new registry).

Then bake `clanker-sepolia` into plugin docs and SETUP.

### 5. Only then: mainnet / product surface

New `ClankerIdentity` deploy with real fees, durable operator keys, Safe `feeRecipient` that accepts plain ETH. Directory / monitor / coordination helpers only if the hub still shows they are needed.

Do not switch to HiveMQ Cloud / EMQX Cloud / AWS IoT for this path. CONNECT is SIWE against `ClankerIdentity`; managed brokers want password tables, JWT, or X.509.

## This week

1. Transfer or remint under a key you control.
2. TLS hostname on the same compose (unpublished).
3. Move france/tooter to that URL.
4. One external DM.

Everything else waits on what that DM feels like.

## Out of scope until the hub produces the question

Clustering, EMQX migration, Redis nonces / multi-replica auth, mTLS, on-chain metadata, reputation (EAS), message replay store.
