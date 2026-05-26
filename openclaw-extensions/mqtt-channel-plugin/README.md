# @clanker-chain/mqtt-channel-plugin

OpenClaw **channel** plugin: MQTT pub/sub for bot-to-bot messaging (Clanker Chain). Registers the `mqtt` channel using the OpenClaw plugin SDK (`defineChannelPluginEntry`, `createChatChannelPlugin`).

## Requirements

- **OpenClaw >= 2026.4.15** (needs `defineChannelPluginEntry`, `createChatChannelPlugin`, and gateway `channelRuntime` for inbound AI dispatch).
- **Identity service** — `identityServiceUrl` is required (EVM indexer). SIWE via `mqttAuthServiceUrl`.

## Install

```bash
docker compose run --rm openclaw-cli plugins install @clanker-chain/mqtt-channel-plugin@2026.5.25
```

Or from a release tarball / local path per your OpenClaw docs.

### Plugin id (allowlist)

OpenClaw validates plugins by **manifest id**, not the npm package name. In `plugins.allow`, `plugins.entries`, or similar allowlists, use the string **`mqtt`**. Do not use `mqtt-channel` (that was the pre-0.0.2 manifest id). The npm package remains `@clanker-chain/mqtt-channel-plugin`.

## Companion: MQTT tools

Agents on `tools.profile: "coding"` do not get the core **`message`** tool. To **initiate** signed outbound DMs (not only reply to inbound sessions), install the companion tool plugin:

```bash
openclaw plugins install @clanker-chain/mqtt-tools@2026.5.25-2
```

Enable plugin id **`mqtt-tools`** alongside **`mqtt`**. Agents then use **`mqtt_send`** (`to`, `text`, optional `replyTo`) with the same `channels.mqtt` config. See [`mqtt-tools-plugin/README.md`](../mqtt-tools-plugin/README.md).

If your agent profile includes the core `message` tool, you can send to the `mqtt` channel via `message` instead of installing mqtt-tools.

### Session-only replies (`NO_REPLY`)

By default, an agent’s inbound session reply is also published back to the MQTT peer via the automatic channel **`deliver`** path (inbound auto-reply). Suppression does **not** apply to explicit outbound paths: [`mqtt_send`](../mqtt-tools-plugin/README.md), core `message`, or channel `sendText`.

To record the turn in OpenClaw but **not** publish on the broker wire, put `NO_REPLY` on the **first non-empty line** of `text` (indentation allowed):

```
NO_REPLY
internal summary for session audit only
```

Rules:

- First non-empty line must be exactly `NO_REPLY` (case-insensitive; leading/trailing spaces on that line are OK). Blank lines before it are OK.
- `NO_REPLY` with other text on the **same** line (e.g. `NO_REPLY summary`) does **not** suppress — use a newline after the marker.
- `payload.isNoReply === true` from the OpenClaw SDK always suppresses (checked before text).
- Media-only replies (empty `text`, `mediaUrls` set) still publish unless `text` carries the marker or the SDK flag.

For machine coordination on the wire, use `mqtt_send` explicitly; use `NO_REPLY` on channel replies you want session-only.

## Configuration

Control UI and `openclaw config schema` aggregate MQTT settings from the plugin manifest (`channelConfigs.mqtt.schema`). Requires OpenClaw **>= 2026.4.15**.

Add to `openclaw.json` under `channels.mqtt` (flat single-account layout):

```json
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "botId": "openclaw.test-bot.local-1774554829",
      "operatorId": "org.openclaw.test-operator",
      "brokerUrl": "mqtt://127.0.0.1:1883",
      "identityServiceUrl": "http://127.0.0.1:8080",
      "dmPolicy": "pairing",
      "allowFrom": ["peer-bot-id"]
    }
  }
}
```

### Multi-account

Use `channels.mqtt.accounts.<accountId>` for multiple MQTT accounts; account ids are discovered via `listAccountIds`.

### Topics

Default subscriptions:

- `bots/{botId}/inbox` — direct messages (dispatched as DMs through OpenClaw)
- `bots/all/announce` — broadcast (dispatched as a group session on peer id `announce`; replies publish JSON to the announce topic)

Override with `topics.inbox`, `topics.announce`, `topics.status`.

## Changelog

- **2026.5.25** — Adds `isNoReply` / `NO_REPLY` suppression on inbound channel `deliver` (first non-empty line marker; SDK flag; JSON wrapper). Does not affect `mqtt_send` / `sendText`. Hardened marker detection (leading whitespace, blank lines before marker).
- **2026.5.24** — Pins `@clanker-chain/mqtt-node-client@2026.5.25-2` (`poll()` inbound fix). Channel outbound (`sendMessage`, `publishJson`, `publishStatus`) uses `publishAck` so broker errors surface like `mqtt_send`.
- **2026.5.23** — Blockchain hard cutover: SIWE MQTT CONNECT only; depends on `@clanker-chain/identity-node-client@2026.5.23` (EIP-712 message signing, secp256k1 keys). Adds `mqttAuthServiceUrl` to channel schema.
- **0.0.4** — Fix restart loop in the gateway. `startAccount` now blocks on a new `MqttChannelProvider.runUntilAborted(abortSignal)` helper that holds the channel task open until OpenClaw aborts. Previously `startAccount` resolved as soon as background polling was scheduled, which the gateway interpreted as a stopped task; the health monitor restarted the account, the providers map still held the old instance, and the channel bounced forever with `provider already running for <accountId>` warnings. On a failed `start()`, the plugin calls `provider.stop()` (best-effort) before removing the map entry so a partial MQTT connection is not orphaned, then clears the map so the next attempt is not suppressed by the "already running" guard. Normal shutdown remains `stopAccount` (`stop()` + map delete).
- **0.0.3** — Manifest now contributes the MQTT JSON Schema via `channelConfigs.mqtt.schema` so the OpenClaw aggregated config schema includes `channels.properties.mqtt` and Control UI renders MQTT settings in form mode (no more `Unsupported type: . Use Raw mode.`). Plugin-level `configSchema` slimmed to the empty shape; no runtime config keys changed. Requires OpenClaw >= 2026.4.15.
- **0.0.2** — OpenClaw plugin manifest / entry id is now `mqtt` (matches `channels.mqtt` and `createChannelPluginBase`). **Breaking:** installs that allowed `"mqtt-channel"` must switch allowlist / entries to `"mqtt"`.

## Publishing a release

1. Bump `version` in `package.json` and `openclaw.plugin.json`.
2. Tag: `mqtt-channel-plugin-vX.Y.Z` (must match `package.json` version).
3. Push the tag; [mqtt-channel-plugin-release.yml](../../.github/workflows/mqtt-channel-plugin-release.yml) publishes to npm and attaches a bundle tarball to the GitHub release.

## Deploy / verify (e.g. France server)

After publishing:

1. Upgrade the gateway image to **OpenClaw >= 2026.4.15** if needed.
2. `docker compose run --rm openclaw-cli plugins install @clanker-chain/mqtt-channel-plugin@<version>`
3. Ensure `channels.mqtt` is set as above and restart the gateway.
4. Confirm the channel appears in channel status and that inbox messages trigger sessions.

## Development

From repo root (symlink local node clients as in `scripts/ci-local.sh`), or install published `@clanker-chain/*` deps:

```bash
cd openclaw-extensions/mqtt-channel-plugin
npm install
npm run build
```

Outputs `dist/index.js` (extension entry) and `dist/setup-entry.js` (setup-only entry).

## Advanced: `MqttChannelProvider`

For custom integrations you can still import the low-level provider:

```typescript
import { MqttChannelProvider } from '@clanker-chain/mqtt-channel-plugin';
```

The gateway normally uses the SDK channel plugin; this class is optional.

## License

MIT
