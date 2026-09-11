### identity-node-client

Node/TypeScript client for the **public-good** `ClankerIdentity` registry. Other products can depend on this package without MQTT, pairing, or OpenClaw.

**Facts · Policy · Transport** — This package reads **Facts** and signs/verifies envelopes. It is not a friends list. Pairing is Policy; hub `/acl` is Transport. Those live in products. → [`docs/trust-model.md`](../../docs/trust-model.md)

## Purpose

- Adopt the registry from any stack: `RegistryClient` over RPC (`chainRpcUrl` + `registryAddress`). mqtt-auth uses the same client; you do not have to. A successor pin must not usurp prior labels (`priorRegistry()` walk — [`docs/registry-lifecycle.md`](../../docs/registry-lifecycle.md)).
- Bot keys under `~/.openclaw/keys/{bot_id}.key`: **secp256k1-eth** only (`0x` + 64 hex), or `BOT_ETH_PRIVATE_KEY` env.
- Chain reads: `RegistryClient` / `IdentityClient.init()`, `getBot()`, EIP-712 domain from `chainId` + `registryAddress`.
- MQTT CONNECT: `issueMqttConnectPassword()` — SIWE `nonce.signatureHex` via mqtt-auth-service.
- Message signing: EIP-712 typed data (`signature_scheme: "eip712-secp256k1"`).

## Install

```bash
cd packages/identity-node-client
npm install
npm run build
```

## Usage

```ts
import { IdentityClient } from "@clanker-chain/identity-node-client";

const client = new IdentityClient({
  botId: "openclaw.france.prod-1",
  operatorId: "org.openclaw.pat",
  chainRpcUrl: "https://sepolia.base.org",
  registryAddress: "0xD650467f9D7A20f37E55ec23Ca1c711598f97958",
  mqttAuthServiceUrl: "http://localhost:9090",
});

await client.init();

const password = await client.issueMqttConnectPassword();
// MQTT username = bot_id; password = SIWE nonce.sig

const { signature, signature_scheme } = await client.signMessage(envelope);
```

Env fallbacks: `CHAIN_RPC_URL` / `BASE_SEPOLIA_RPC_URL`, `REGISTRY_ADDRESS`, `MQTT_AUTH_SERVICE_URL`.

## Caching

| Surface | Default TTL | Notes |
|---------|-------------|--------|
| mqtt-auth `RegistryClient` | `0` (uncached) | Revoke / `rotateBotKey` take effect on the next CONNECT |
| Bot `IdentityClient` | `10s` | Rate-limit friendly on public RPCs; a revoked peer may still pass `verifyMessage` until TTL expires. Override with `cacheTtlMs: 0` if you need immediate enforcement on the messaging path. |

## Version

CalVer `2026.9.10` — chain-direct registry reads over RPC.
