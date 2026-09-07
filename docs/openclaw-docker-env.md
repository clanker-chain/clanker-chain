# OpenClaw Docker env (deprecated bake-in path)

**Do not use this document for new installs.**

The supported path is a local checkout install (CalVer `2026.7.29` is not on npm until `file:` pins are published — see [`VERSIONING.md`](VERSIONING.md)):

```bash
# from clanker-chain repo root after building plugins — see SETUP.md
openclaw plugins install "$(pwd)/openclaw-extensions/mqtt-channel-plugin"
openclaw plugins install "$(pwd)/openclaw-extensions/mqtt-tools-plugin"
```

Then configure `plugins.enabled` (`mqtt`, `mqtt-tools`) and `channels.mqtt` with `chainRpcUrl` + `registryAddress`. See [`SETUP.md`](../SETUP.md) and [`openclaw-extensions-quickstart.md`](openclaw-extensions-quickstart.md).

Legacy notes (GitHub release asset IDs, `IDENTITY_ASSET_ID`, baking `clanker-chain-identity` into the image) are obsolete. Do not set `IDENTITY_SERVICE_URL` for CONNECT.
