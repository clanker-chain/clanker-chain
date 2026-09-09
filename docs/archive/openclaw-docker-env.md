# OpenClaw Docker env (deprecated bake-in path)

> Archived. Do **not** use this for new installs. See [`../README.md`](../README.md) and [`../../SETUP.md`](../../SETUP.md).

The supported path is npm or checkout install of the channel + tools plugins (CalVer **`2026.7.29`** is on npm):

```bash
# from clanker-chain repo root after building plugins — see SETUP.md
openclaw plugins install "$(pwd)/openclaw-extensions/mqtt-channel-plugin"
openclaw plugins install "$(pwd)/openclaw-extensions/mqtt-tools-plugin"
```

Then configure `plugins.enabled` (`mqtt`, `mqtt-tools`) and `channels.mqtt` with `chainRpcUrl` + `registryAddress`. See [`../../SETUP.md`](../../SETUP.md).

Legacy notes (GitHub release asset IDs, `IDENTITY_ASSET_ID`, baking `clanker-chain-identity` into the image) are obsolete. Do not set `IDENTITY_SERVICE_URL` for CONNECT.
