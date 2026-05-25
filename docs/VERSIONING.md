# Versioning (CalVer)

All `@clanker-chain/*` npm packages use **calendar versioning** tied to release date:

- Format: `YYYY.M.D` (npm-normalized; e.g. release on 2026-05-23 → **`2026.5.23`**)
- Any wire-format or crypto breaking change requires a **new date version** (no semver major/minor semantics)

## Tag format

Git tags must match `package.json` exactly:

| Package | Tag example |
|---------|-------------|
| `@clanker-chain/identity-node-client` | `identity-node-client-v2026.5.23` |
| `@clanker-chain/mqtt-node-client` | `mqtt-node-client-v2026.5.23` |
| `@clanker-chain/mqtt-channel-plugin` | `mqtt-channel-plugin-v2026.5.23` |
| `@clanker-chain/mqtt-tools` | `mqtt-tools-plugin-v2026.5.24` |
| `@clanker-chain/mqtt-plugin` | `mqtt-plugin-v2026.5.23` |
| `@clanker-chain/identity-plugin` | `identity-plugin-v2026.5.23` |

## Inter-package dependencies

Pin **exact** CalVer (no `^` or `~`):

```json
"@clanker-chain/identity-node-client": "2026.5.23"
```

## Publish order

1. `@clanker-chain/identity-node-client`
2. `@clanker-chain/mqtt-node-client`
3. `@clanker-chain/mqtt-channel-plugin`
4. `@clanker-chain/mqtt-tools` (requires channel plugin + `channels.mqtt`; install after node clients)
5. `@clanker-chain/mqtt-plugin`
6. `@clanker-chain/identity-plugin` (deprecated; superseded by identity-node-client)

Wait for npm registry propagation between steps when installing published deps in CI.

## Non-npm services

`identity-service`, `mqtt-auth-service`, and `clanker-cli` use the same CalVer string in their `package.json` for traceability; they are deployed from the repo or Docker, not published to npm.

## Release notes

Document wire breaking changes explicitly (MQTT auth, key file format, `signature_scheme`, identity write path).
