# Identity snapshot directory

**Deprecated path.** Do not treat this directory or the HTTP indexer as part of hub runtime.

Bots and mqtt-auth read `ClankerIdentity` over RPC via `@clanker-chain/identity-node-client` (`RegistryClient`). Mint with `clanker chain mint-*`.

- Migrated docs: [`identity-service/DEPRECATED.md`](../identity-service/DEPRECATED.md)
- Operator setup: [`SETUP.md`](../SETUP.md)

The committed `bot-identity-ledger.json` (if present) is a local Anvil snapshot for the optional deprecated explorer only — not production registry state.
