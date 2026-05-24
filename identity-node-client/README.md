### identity-node-client

Node/TypeScript client for the EVM-backed identity service.

## Purpose

- Bot keys under `~/.openclaw/keys/{bot_id}.key`: **secp256k1-eth** only (`0x` + 64 hex), or `BOT_ETH_PRIVATE_KEY` env.
- HTTP reads: `init()`, `GET /v1/operators/{id}`, `GET /v1/bots/{id}`, `GET /health` (EIP-712 domain).
- MQTT CONNECT: `issueMqttConnectPassword()` — SIWE `nonce.signatureHex` via mqtt-auth-service.
- Message signing: EIP-712 typed data (`signature_scheme: "eip712-secp256k1"`).

## Install

```bash
cd identity-node-client
npm install
npm run build
```

## Usage

```ts
import { IdentityClient } from "@clanker-chain/identity-node-client";

const client = new IdentityClient({
  botId: "openclaw.france.prod-1",
  operatorId: "org.openclaw.pat",
  identityServiceUrl: "http://localhost:8080",
  mqttAuthServiceUrl: "http://localhost:9090",
});

await client.init();

const password = await client.issueMqttConnectPassword();
// MQTT username = bot_id; password = SIWE nonce.sig

const { signature, signature_scheme } = await client.signMessage(envelope);
```

## Version

CalVer `2026.5.23` — blockchain hard cutover release.
