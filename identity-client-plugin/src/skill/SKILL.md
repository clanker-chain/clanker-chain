---
name: identity
description: DEPRECATED — use skills/identity with CHAIN_RPC_URL + REGISTRY_ADDRESS and @clanker-chain/identity-node-client.
metadata:
  {"openclaw":{"requires":{"env":["CHAIN_RPC_URL","REGISTRY_ADDRESS"]},"primaryEnv":"CHAIN_RPC_URL"}}
---

# Identity skill (DEPRECATED)

**This plugin package (`@clanker-chain/identity-plugin`) is deprecated.** Prefer:

- Workspace skill: [`skills/identity`](../../../skills/identity/)
- Library: `@clanker-chain/identity-node-client` (RPC to `ClankerIdentity`)
- Minting: `clanker-cli` (`chain mint-operator` / `chain mint-bot`)

Do **not** configure `IDENTITY_SERVICE_URL` for MQTT CONNECT — hub auth reads the registry via RPC (`CHAIN_RPC_URL` + `REGISTRY_ADDRESS`).

## Migration

| Old | New |
|-----|-----|
| `IDENTITY_SERVICE_URL` | `CHAIN_RPC_URL` + `REGISTRY_ADDRESS` |
| HTTP `GET /v1/bots/:id` | `IdentityClient` / `RegistryClient` |
| Ed25519 JWT CONNECT | SIWE via mqtt-auth |

See [`SETUP.md`](../../../SETUP.md) and [`identity-service/DEPRECATED.md`](../../../identity-service/DEPRECATED.md).
