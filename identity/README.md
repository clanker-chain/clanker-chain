### Identity ledger and keys

This directory contains the **local, append-only identity ledger** for the bot mesh, as described in `bot-comms.md`.

---

## Files

- `bot-identity-ledger.json`  
  - Logical ledger for operators and bots.
  - PoC storage backing the identity access layer (`get_bot`, `get_operator`, `list_keys`, etc.).
  - Mirrors the structure described in `bot-comms.md`:
    - `operators[operator_id]` entries with public keys and metadata.
    - `bots[bot_id]` entries with public keys, aliases, and status.

---

## Where private keys live

Per `bot-comms.md`, **private keys are stored on each bot machine**, not in this repo.

- Each bot keeps its Ed25519 keypair at:

  - `~/.openclaw/keys/{bot_id}.key`

- On startup, a bot:
  - Loads or generates this keypair.
  - Ensures its **public key** is registered in `bot-identity-ledger.json` under its `bot_id`.

For this PoC:

- Replace the placeholder `public_key` values in `bot-identity-ledger.json` with the **base64-encoded public keys** derived from each bot’s local key file.
- Keep this ledger file **append-only**:
  - Add new keys with `status: "active"`.
  - Mark old keys `status: "revoked"` instead of deleting them.

---

## Updating the ledger

For now, you can treat updates as being managed by a single "identity manager" on the machine that hosts this repo:

1. Generate or load keys for each bot on its machine.
2. Export the bot’s public key (base64).
3. Edit `bot-identity-ledger.json`:
   - Add or update the relevant `operators[operator_id]` / `bots[bot_id]` entry.
   - Bump the `updated` timestamp if needed.

Later phases can replace this JSON file with a more robust ledger backend while keeping the access-layer API stable.

