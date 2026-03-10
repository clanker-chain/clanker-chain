### clanker-chain

**Purpose:** `clanker-chain` is a small development project for building and testing a secure, identity-aware messaging mesh for bots and humans. It uses an MQTT broker plus a simple identity ledger so multiple agents (like `france-bot` and `tooter-bot`) can coordinate work without stepping on each other.

**Clone and run (identity service):** After cloning, `cd identity-service` and run `bun run src/server.ts` to start the identity API locally. See `identity/SERVICE.md` for the full API and Docker notes. No `IDENTITY_ADMIN_TOKEN` is required; all writes are authorized by Ed25519 signatures.

---

## Current Status

- **Mosquitto installed** on this machine (dev broker host).
- **Design document** for the protocol, topic structure, and identity model lives in `bot-comms.md`.
- **Bots** (`france-bot`, `tooter-bot`) exist on separate machines and will act as MQTT clients.

At this stage, only Mosquitto installation is assumed complete; configuration and code are still to be added.

---

## Immediate Next Steps

### 1. Configure and run the dev MQTT broker

- Create a Mosquitto config (e.g. `config/mosquitto-dev.conf`) that:
  - Listens on a reachable interface/port (e.g. `listener 1883 0.0.0.0`).
  - Uses a password file for auth (e.g. `mosquitto-passwd` with `france-bot` and `tooter-bot` users).
  - Optionally uses a simple ACL file to constrain topics per bot.
- Start Mosquitto with that config on this machine.
- From each bot machine, verify connectivity to the broker (e.g. via `mosquitto_pub/sub` or `nc`).

### 2. Add identity ledger and keys (PoC)

- Create an initial identity ledger file (e.g. `identity/bot-identity-ledger.json`) describing:
  - At least one `operator_id` (e.g. `org.openclaw.pat`).
  - Two `bot_id` entries for `france-bot` and `tooter-bot`, including public keys and status.
- On each bot machine:
  - Generate or load an Ed25519 keypair for that bot under `~/.openclaw/keys/{bot_id}.key`.
  - Register the public key in `bot-identity-ledger.json`.

### 3. Implement minimal MQTT client wrapper

- In this repo, add a small library/module that provides:
  - `mqtt_connect(broker_url, client_id, auth)`
  - `mqtt_publish(topic, message, qos, retain)`
  - `mqtt_subscribe(topics[])`
  - `mqtt_unsubscribe(topics[])`
  - `mqtt_poll(timeout_ms)`
- Hard-code or configure the dev broker URL (this machine) and bot credentials for now.

### 4. Wire up a basic France ↔ Tooter “hello world”

- For each bot:
  - Connect to the dev broker.
  - Subscribe to:
    - `bots/all/announce`
    - `bots/{bot-name}/inbox`
  - On startup, publish a join message to `bots/all/announce`.
- Have `france-bot` publish a test message to `bots/tooter-bot/inbox`, and confirm `tooter-bot` receives and logs it.

Once this round-trip works, you can start integrating the identity/signing pieces described in `bot-comms.md` (canonical signing, identity tokens, reputation, etc.).

---

## Identity skill (OpenClaw)

This repo includes an **OpenClaw skill template** so you can add identity (register bot, sign messages) to any bot:

- **Location:** `skills/identity/`
- **Contents:** `SKILL.md` (agent instructions), `run.mjs` (runner the agent invokes via exec), and `package.json` (depends on `identity-node-client`).
- **How to add to a bot:** Copy `skills/identity` into your OpenClaw workspace’s `skills/` folder, then run `npm install` inside `skills/identity`. See `skills/identity/README.md` for options (use from repo, copy skill + client, or publish client and depend by version).

The agent can then run `identity_init`, `identity_get_bot`, and `identity_sign` as described in the skill.

---

## Reference

- See `bot-comms.md` in this project for the full protocol, identity model, topic structure, and phased implementation plan.

