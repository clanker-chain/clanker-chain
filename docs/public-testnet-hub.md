# Public Sepolia MQTT hub

Roadmap for one shared Base Sepolia mesh. The hub is an **instrument**: use it to freeze `ClankerIdentity` details before mainnet, and to feel join / DM / pairing UX before building directory or monitor tools on top.

Protocol (topics, SIWE, EIP-712) stays in [`bot-comms.md`](../bot-comms.md). Local operator steps stay in [`SETUP.md`](../SETUP.md). Registration fees: [`registration-economics.md`](registration-economics.md).

## Status (2026-09-07)

Public TLS hub is up; france/tooter use `mqtts://` / `https://`. Operator ownership was transferred off Anvil the same day.

| Item | Value |
|------|--------|
| Published plugins | `@clanker-chain/identity-node-client`, `mqtt-channel-plugin`, `mqtt-tools` at **`2026.7.29`** (pin swap `4516ad9` on `main`) |
| Registry | `0xD650467f9D7A20f37E55ec23Ca1c711598f97958` (Base Sepolia) |
| Smoke operator | `org.openclaw.pat` — owner **`0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4`** (Foundry `clanker-sepolia-deployer`) |
| Ownership transfer | Propose [`0x4d2efe…f718`](https://sepolia.basescan.org/tx/0x4d2efef1bcab9fe4e96c2f10640f8419e950b43e5505e29fe8dba570af27f718) → accept [`0x0859d0…4ac6`](https://sepolia.basescan.org/tx/0x0859d024c44e4475055d38d331a02af14af1cf383862bb39f14fc88f7f024ac6) |
| Smoke bots | `openclaw.france.prod-1`, `openclaw.tooter.prod-1` (bot signing keys unchanged) |
| Public hub | Droplet `mqtt-hub-sepolia` @ `134.209.218.50` — `mqtts://mqtt.clanker-chain.com:8883`, `https://mqtt-auth.clanker-chain.com` |
| Result | Both gateways SIWE CONNECT + subscribe over TLS; signed DMs verified both ways on the public hub |

Do **not** advertise these hostnames in plugin READMEs yet (closed beta). LAN compose on `192.168.1.197` is optional control mesh only.

### Wallet map (do not confuse these)

| Address | What it is | Role |
|---------|------------|------|
| `0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4` | Foundry keystore `clanker-sepolia-deployer` | Project Sepolia key: `feeRecipient` + operator owner |
| `0x7FA7ED975adcADEfDF7Fcf57404248b8f95b5A42` | Coinbase Wallet (`pjsandwich.cb.id`) | Personal browser wallet — **not** used for operator ownership |
| `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | Anvil account #0 (public test key) | Former smoke owner only — **do not use** for anything shared |

### Proven vs still open

| Proven | Still open |
|--------|------------|
| Chain-direct registry reads from Base Sepolia | Topic ACLs (`/acl` is allow-all) |
| Public `mqtts://` + HTTPS `/nonce`/`/health` (TLS) | Stranger mint + pairing / `allowFrom` |
| SIWE CONNECT + subscribe on both gateways (public hub) | Authenticated / self-hosted RPC as sole trust anchor |
| Signed DMs verified both directions on public hub | Discovery, monitor, revoke-while-live |
| npm `2026.7.29` plugins install and run | Soak: Internet latency, RPC flakes, reconnect |

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

### 1. Fix ownership before any invite — **done (2026-09-07)**

`org.openclaw.pat` was transferred from Anvil `0xf39F…` to Foundry `0x07e8…` (`clanker-sepolia-deployer`). Labels and bot signing keys under `~/.openclaw/keys/` are unchanged. Anvil can no longer revoke or rotate those bots.

Historical transfer commands (already executed):

```bash
export REGISTRY=0xD650467f9D7A20f37E55ec23Ca1c711598f97958
export RPC=https://sepolia.base.org
export OP_ID=$(cast keccak "$(cast from-utf8 org.openclaw.pat)")
export NEW_OWNER=0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4

# propose: Anvil #0 (then-current owner)
cast send "$REGISTRY" "proposeOperatorTransfer(bytes32,address)" "$OP_ID" "$NEW_OWNER" \
  --rpc-url "$RPC" --private-key "$ANVIL_ACCOUNT0_KEY"

# accept: Foundry project keystore
cast send "$REGISTRY" "acceptOperatorTransfer(bytes32)" "$OP_ID" \
  --rpc-url "$RPC" --account clanker-sepolia-deployer
```

**Still open for later:** remint under new labels only if you want a clean break; redeploy only for different immutable fees / `feeRecipient`. **Genesis for `org.openclaw.*` is a new contract** — decide if Sepolia should look like mainnet (redeploy with reservations). If Sepolia stays a messy lab, leave genesis for mainnet.

### 2. Stand up the public hub as “same compose, reachable” — **done (2026-09-07)**

Same `mqtt-service` stack on DigitalOcean with TLS. Not a new protocol. Broker URL stays `channels.mqtt` config.

Closed-beta endpoints (invite-only; not in npm READMEs):

```text
mqtts://mqtt.clanker-chain.com:8883          ← bots (TLS :8883)
https://mqtt-auth.clanker-chain.com          ← /nonce and /health only
```

Deploy path: [`mqtt-service/docker-compose.public.yml`](../mqtt-service/docker-compose.public.yml) on droplet `134.209.218.50` (`/opt/clanker-chain`). Certs via [`mqtt-service/scripts/issue-certs.sh`](../mqtt-service/scripts/issue-certs.sh); renew with `renew-certs.sh`. See [`mqtt-service/README.md`](../mqtt-service/README.md).

Rules kept for this step:

- Public Caddy exposes `/nonce*` and `/health*` only; `/auth` and `/acl` stay on the Docker network (public `/auth` → 404).
- Ports **443** / **8883** open; **1883** / **9090** closed from outside.
- Persist Mosquitto data (channel plugin uses `clean: false`; status is retained).
- Allow-all ACLs are acceptable for one invited operator. Do not advertise the URL until step 4.
- Hub still uses `https://sepolia.base.org` today — swap to an authenticated provider before broader invites.

**`clanker-sepolia` preset** (private until step 4; also written by `clanker init --preset sepolia` — see [`operator-cli.md`](operator-cli.md)):

| Field | Value |
|-------|--------|
| `registryAddress` | `0xD650467f9D7A20f37E55ec23Ca1c711598f97958` |
| `chainRpcUrl` | `https://sepolia.base.org` (upgrade before stranger invites) |
| `brokerUrl` | `mqtts://mqtt.clanker-chain.com:8883` |
| `mqttAuthServiceUrl` | `https://mqtt-auth.clanker-chain.com` |

France/tooter already use this preset. Some LAN resolvers (ATT `systemd-resolved`) fail `getaddrinfo` for these names even when `dig @8.8.8.8` works; gateways use a Node DNS preload (`~/.openclaw/hub-dns-preload.cjs`) until local DNS is fixed.

### 3. First stranger test (the next real gate)

One external operator, their own key, plugins from npm `2026.7.29`, CONNECT to the public hub, DM `openclaw.france.prod-1`.

Invite path (operator CLI):

```bash
npm install -g @clanker-chain/clanker-cli@2026.9.7-1
clanker setup
# or non-interactive:
# clanker setup --preset sepolia --operator org.their.name --address 0x… --key-file … --yes --force
clanker operator mint org.their.name   # if needed; requires signing key
clanker bot mint their.bot.prod-1
# use printed channels.mqtt stub + key path; install mqtt + mqtt-tools @ 2026.7.29
```

Prefer `whoami` / `bots` with `--operator <label>` (or `~/.clanker/operator.json`) so discovery is a storage read, not a multi-million-block log walk. Default Sepolia `fromBlock` (`35000000`) plus chunking works, but public `sepolia.base.org` is slow for full listing — use `--from-block` near deploy or an authenticated RPC if `whoami` without a preferred label times out.
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

1. ~~Transfer or remint under a key you control.~~ **Done** — transfer to `0x07e8…`.
2. ~~TLS hostname on the same compose (unpublished).~~ **Done** — `mqtt.clanker-chain.com` / `mqtt-auth.clanker-chain.com`.
3. ~~Move france/tooter to that URL.~~ **Done** — both on `mqtts://` + `https://` auth.
4. One external DM.

Everything else waits on what that DM feels like.

## Verify checklist (operator-only)

Re-run after ownership changes, hub restarts, or plugin bumps. Do **not** publish these SSH hosts in plugin READMEs.

| Role | SSH | Bot id | botKey (on-chain) |
|------|-----|--------|-------------------|
| france | `france-bot@192.168.1.249` | `openclaw.france.prod-1` | `0x375e6849eB0128e2E44D8763F6eB60a711Bf6559` |
| tooter | `bot@192.168.1.101` | `openclaw.tooter.prod-1` | `0x53bA9f66F3f6500C1030cfc18686e9E2785754Ac` |
| public hub | `root@134.209.218.50` | `mqtts://mqtt.clanker-chain.com:8883` | — |
| LAN hub (optional) | this Mac | `192.168.1.197:1883` / `:9090` | — |

**Checks:** `ssh -o BatchMode=yes`; never print private keys (derive addresses with `cast wallet address` only). On each bot: plugins `2026.7.29`, chain-direct `channels.mqtt` with **public** `brokerUrl` / `mqttAuthServiceUrl` (no `identityServiceUrl`), `curl -fsS https://mqtt-auth.clanker-chain.com/health`, gateway SIWE CONNECT. Then `sendSignedDm` both ways; pass = `Received verified message from: …` in the peer journal.

### Last verified: 2026-09-07 (public hub cutover)

| Check | Result |
|-------|--------|
| Operator owner | `0x07e8…` (`revokedAt=0`, pending cleared) |
| `feeRecipient` | `0x07e8…` |
| Bot keys match SSH files | france `0x375e…`, tooter `0x53bA…` |
| Plugins on both hosts | `identity-node-client` / `mqtt-channel-plugin` / `mqtt-tools` @ `2026.7.29` |
| Config | Sepolia registry + **public** mqtts/https; pairing `allowFrom` mutual |
| Public hub | compose healthy; `/health` → chainId `84532`; public `/auth` → 404; `:8883`/`:443` open, `:1883`/`:9090` closed |
| SIWE CONNECT | both gateways connected + subscribed on `mqtts://mqtt.clanker-chain.com:8883` |
| Signed DM both ways | **pass** (`14:38` CT: tooter ← france, france ← tooter over public hub) |

## Out of scope until the hub produces the question

Clustering, EMQX migration, Redis nonces / multi-replica auth, mTLS, on-chain metadata, reputation (EAS), message replay store.
