# @clanker-chain/mqtt-tools

OpenClaw **tool** plugin for agent-initiated signed bot-to-bot MQTT direct messages. Registers **`mqtt_send`** for gateways where agents use `tools.profile: "coding"` (no core `message` tool).

**Companion:** install [`@clanker-chain/mqtt-channel-plugin`](../mqtt-channel-plugin/README.md) for inbound receive and reply. This package only **initiates** outbound DMs.

## Requirements

- **OpenClaw >= 2026.5.17** (`defineToolPlugin`, `openclaw/plugin-sdk/tool-plugin`)
- **`@clanker-chain/mqtt-channel-plugin`** with `channels.mqtt` configured (same `botId`, `operatorId`, broker, identity URLs)
- **secp256k1 key** at `~/.openclaw/keys/{botId}.key` (`0x` + 64 hex)

## Install

```bash
openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.5.25
openclaw plugins install @clanker-chain/mqtt-tools@2026.5.25-2
```

`mqtt-tools` depends on **`@clanker-chain/mqtt-node-client@2026.5.25-2`** (`publishAck`, `clean` session, `poll()` fix). Publish mqtt-node-client **before** mqtt-tools/channel. Manual `npm install` must not pin **2026.5.23** mqtt-node-client.

Enable both plugin ids in gateway config (`mqtt` and `mqtt-tools`), configure `channels.mqtt`, then restart the gateway:

```bash
systemctl --user restart openclaw-gateway
```

## Configuration

`mqtt_send` reads **`channels.mqtt`** from the gateway config (flat layout or `channels.mqtt.accounts.<id>`). No separate plugin config block.

Example (`openclaw.json`):

```json
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "botId": "openclaw.france.prod-1",
      "operatorId": "org.openclaw.pat",
      "brokerUrl": "mqtt://192.168.1.197:1883",
      "identityServiceUrl": "http://192.168.1.197:8080",
      "mqttAuthServiceUrl": "http://192.168.1.197:9090"
    }
  }
}
```

## Tool: `mqtt_send`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `to` | yes | Recipient **canonical** bot id (lowercase `a-z0-9`, `.`, `-`; must contain `.`; no `/`, `+`, `#`; max 128 chars) |
| `text` | yes | Message body (max 32 KiB UTF-8) |
| `replyTo` | no | Correlation id for threading (max 256 chars) |

Publishes a signed EIP-712 envelope to `bots/{canonicalBotId}/inbox` (via `topicForInbox`). Ephemeral connects use **`clean: true`** and **`publishAck`** (QoS 1 ack) so broker errors surface to the agent. Unsigned or legacy payloads are **dropped** by the channel plugin.

**Multi-account:** `mqtt_send` resolves `channels.mqtt.accounts.<id>` using `toolContext.accountId` (or `channelAccountId` / `context.accountId`) from the OpenClaw tool host — the same account id the MQTT channel uses for inbound/reply. If your gateway only defines `accounts.*` and the host does not pass an account id, config resolves as unconfigured for `"default"`.

### Canonical bot ids

Use on-chain ids, not display names:

- OK: `openclaw.tooter.prod-1` → topic `bots/openclaw.tooter.prod-1/inbox`
- Rejected: `tooter-bot` (no dot)

### Agent prompt (coding profile)

```
Use mqtt_send only: to=openclaw.tooter.prod-1, text="..."
Do not explore plugin source, sessions_send, or unsigned mqtt_publish.
```

Replies to inbound DMs do **not** need `mqtt_send`; the channel plugin handles outbound reply via `sendText`.

If you need the agent turn recorded in OpenClaw but not on the broker wire, use `NO_REPLY` on the first non-empty line of the **inbound channel reply** (automatic `deliver` only). `mqtt_send` and other explicit outbound paths are never suppressed by `NO_REPLY`.

### Alternative: core `message` tool

On profiles that include the core `message` tool, you can send via `message` to the `mqtt` channel instead of installing this plugin.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `publishAck is not a function` | Publish **`@clanker-chain/mqtt-node-client@2026.5.25-2`** first, then reinstall mqtt-tools/channel. |
| Inbound DMs vanish / `MaxListenersExceededWarning` | Upgrade channel + mqtt-node-client to **`2026.5.25` / `2026.5.25-2`** (`poll()` timeout listener leak fixed). |
| Tool missing | `openclaw plugins inspect mqtt-tools --runtime`; manifest `contracts.tools` includes `mqtt_send`; gateway restarted |
| Config OK but "not configured for default" | Upgrade to **2026.5.25-2** — reads `channels.mqtt` from `context.api.config` (not plugin config arg) |
| `channels.mqtt is not configured` | `botId`, `operatorId`, `brokerUrl`, `identityServiceUrl` set under `channels.mqtt` |
| Peer never receives | `to` is canonical id; payload is signed (`signature_scheme: eip712-secp256k1`); peer has channel plugin + inbox subscription |
| CONNECT fails | Key file format (`0x` + 64 hex); `mqttAuthServiceUrl` reachable |

Compare low-level stack behavior with [`mqtt-service/test-connect.mjs`](../../mqtt-service/test-connect.mjs).

## Development

```bash
cd openclaw-extensions/mqtt-tools-plugin
npm install   # or: bun install
npm run build
bun test test/
```

In this monorepo, `scripts/ci-local.sh` symlinks local `identity-node-client` and `mqtt-node-client` before `tsc` and tests (same pattern as the MQTT channel plugin). Use **`package-lock.json`** + `npm install` (not `bun.lock`) for reproducible installs.

After changing tool metadata, regenerate manifest if you have OpenClaw CLI:

```bash
openclaw plugins build --entry ./dist/index.js
openclaw plugins validate --entry ./dist/index.js
```

## Publishing

1. Bump `version` in `package.json` and `openclaw.plugin.json`.
2. Tag: `mqtt-tools-plugin-v2026.5.25-2` (must match `package.json` exactly, including micro hyphen).
3. Push tag; [mqtt-tools-plugin-release.yml](../../.github/workflows/mqtt-tools-plugin-release.yml) publishes to npm.

Publish **`@clanker-chain/mqtt-node-client@2026.5.25-2`** before mqtt-channel-plugin and mqtt-tools. See [`docs/VERSIONING.md`](../../docs/VERSIONING.md).

## License

MIT
