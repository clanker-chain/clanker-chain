### Identity snapshot (EVM indexer)

This directory holds a **materialized snapshot** of on-chain `ClankerIdentity` state, written by `identity-service` (`EvmBackend`).

---

## Files

- **`bot-identity-ledger.json`**
  - Read-only cache of indexed chain events (operators, bots, active `secp256k1-eth` keys).
  - **Not** an append-only JSON ledger and **not** edited by hand.
  - Includes `meta` (`lastIndexedBlock`, `chainId`, `registryAddress`) from the indexer.
  - The empty `operations` array is a legacy schema field; writes happen on-chain only.

Regenerate by running the identity service against your RPC + registry (see [`SERVICE.md`](./SERVICE.md) and [`chain/README.md`](../chain/README.md)).

The indexer rewrites this file only when **operators or bots** change (not on every Anvil block). `meta.lastIndexedBlock` is flushed on shutdown. Restart `identity-service` after pulling indexer changes.

---

## Keys

Bot private keys live on each bot host:

- `~/.openclaw/keys/{bot_id}.key` — **secp256k1** (`0x` + 64 hex chars)

Public keys in the snapshot use `algorithm: "secp256k1-eth"` and a **20-byte Ethereum address** (`0x…`), not Ed25519/base64.

Register and rotate on-chain:

```bash
node clanker-cli/bin/clanker.mjs chain mint-operator org.openclaw.pat --registry "$REGISTRY"
node clanker-cli/bin/clanker.mjs chain mint-bot openclaw.france.prod-1 org.openclaw.pat --registry "$REGISTRY"
```

---

## API reference

See [`references/api-spec.md`](./references/api-spec.md) and [`SERVICE.md`](./SERVICE.md).
