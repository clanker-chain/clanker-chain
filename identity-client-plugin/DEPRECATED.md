# @clanker-chain/identity-plugin

**Deprecated.** This package is frozen at CalVer `2026.5.23` and superseded by [`@clanker-chain/identity-node-client`](https://www.npmjs.com/package/@clanker-chain/identity-node-client) (`2026.5.23`).

The legacy plugin uses Ed25519 + JWT and is incompatible with the blockchain identity cutover (EVM registry, SIWE MQTT auth, EIP-712 message signing).

## Migration

```bash
openclaw plugins install @clanker-chain/identity-node-client@2026.5.23
# or use @clanker-chain/mqtt-channel-plugin which depends on identity-node-client
```

Bot keys must be secp256k1 hex (`0x` + 64 chars) matching the on-chain `botKey`.

On publish, run:

```bash
npm deprecate @clanker-chain/identity-plugin@2026.5.23 "Superseded by @clanker-chain/identity-node-client@2026.5.23"
```
