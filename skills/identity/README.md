# Identity skill (OpenClaw)

> **DEPRECATED as a primary install path.** For messaging, use `@clanker-chain/mqtt-channel-plugin` + `@clanker-chain/mqtt-tools` ([`SETUP.md`](../../SETUP.md)). For library access, depend on `@clanker-chain/identity-node-client` directly.

This folder remains an optional skill template that wraps `identity-node-client` (`identity_init`, `identity_get_bot`, `identity_sign`). Prefer published plugins for production bots.

If you still copy this skill into a workspace:

1. Depend on `@clanker-chain/identity-node-client` from this repo (`file:` / local build) or a published CalVer after release (see [`docs/VERSIONING.md`](../../docs/VERSIONING.md)).
2. Set `CHAIN_RPC_URL` and `REGISTRY_ADDRESS` for the agent.
3. See [`SKILL.md`](./SKILL.md) for command details.
