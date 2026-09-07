---
name: identity
description: DEPRECATED — use @clanker-chain/identity-node-client and mqtt + mqtt-tools plugins. This package throws on construct.
metadata:
  {"openclaw":{"requires":{"env":["CHAIN_RPC_URL","REGISTRY_ADDRESS"]},"primaryEnv":"CHAIN_RPC_URL"}}
---

# Identity skill (DEPRECATED)

**`@clanker-chain/identity-plugin` is deprecated.** Prefer:

- Plugins: `@clanker-chain/mqtt-channel-plugin` + `@clanker-chain/mqtt-tools` ([`SETUP.md`](../../../SETUP.md))
- Library: `@clanker-chain/identity-node-client`
- Minting: `clanker-cli` (`chain mint-*`)

The skill runner throws a migration error. See [`DEPRECATED.md`](../../DEPRECATED.md).
