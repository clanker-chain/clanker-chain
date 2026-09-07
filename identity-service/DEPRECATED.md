# DEPRECATED — identity-service

**Status:** Deprecated as of CalVer `2026.7.29`. Not required for hub runtime or bot messaging.

## What changed

Bot and mqtt-auth **identity reads** now go directly to `ClankerIdentity` via RPC using `@clanker-chain/identity-node-client` (`RegistryClient`).

Hub runtime is **Mosquitto + mqtt-auth-service** only. Minting remains on-chain via `clanker-cli`.

## What this package is now

An optional **local explorer / indexer** HTTP API over the same contract events. Safe to run for debugging; do not treat it as a dependency for CONNECT, EIP-712 domain, or peer-key verify.

## Migration

| Before | After |
|--------|--------|
| `IDENTITY_SERVICE_URL` / `identityServiceUrl` | `CHAIN_RPC_URL` + `REGISTRY_ADDRESS` / `chainRpcUrl` + `registryAddress` |
| mqtt-auth → `GET /v1/bots/:id` | mqtt-auth → `RegistryClient` |
| OpenClaw plugins → identity HTTP | OpenClaw plugins → `IdentityClient` → RPC |

Package tree deletion is deferred to a follow-up.
