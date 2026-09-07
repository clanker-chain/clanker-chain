# OpenClaw Docker env (deprecated bake-in path)

**Do not use this document for new installs.**

The supported path is:

```bash
openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.7.29
openclaw plugins install @clanker-chain/mqtt-tools@2026.7.29
```

Then configure `plugins.enabled` (`mqtt`, `mqtt-tools`) and `channels.mqtt` with `chainRpcUrl` + `registryAddress`. See [`SETUP.md`](../SETUP.md) and [`openclaw-extensions-quickstart.md`](openclaw-extensions-quickstart.md).

Legacy notes (GitHub release asset IDs, `IDENTITY_ASSET_ID`, baking `clanker-chain-identity` into the image) are obsolete. Do not set `IDENTITY_SERVICE_URL` for CONNECT.
