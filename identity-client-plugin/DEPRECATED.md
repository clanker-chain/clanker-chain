# DEPRECATED — `@clanker-chain/identity-plugin`

This package is the legacy Ed25519 / `IDENTITY_SERVICE_URL` HTTP client.

**Do not use it** for new bots or MQTT CONNECT.

Use instead:

| Need | Package / tool |
|------|----------------|
| Reads, SIWE, EIP-712 | `@clanker-chain/identity-node-client` |
| Mint operator/bot | `clanker-cli` (`chain mint-*`) |
| OpenClaw skill | `skills/identity` in this repo |

`IdentityClient` construction and the skill runner throw with a migration pointer. See also [`identity-service/DEPRECATED.md`](../identity-service/DEPRECATED.md).
