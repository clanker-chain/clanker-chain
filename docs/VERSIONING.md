# Versioning (CalVer)

All `@clanker-chain/*` npm packages use **calendar versioning** tied to release date:

- Format: **`YYYY.M.D`** (npm-normalized; e.g. release on 2026-05-25 → **`2026.5.25`**)
- Any wire-format or crypto breaking change requires a **new date version** (no semver major/minor semantics)

## Same-day micro releases

When you need **more than one npm publish of the same package on the same calendar day**, use a **micro** suffix:

| Kind | npm `version` | Git tag suffix | When |
|------|----------------|----------------|------|
| First release that day | `2026.5.25` | `…-v2026.5.25` | First publish on May 25 |
| Micro (same day) | `2026.5.25-1`, `2026.5.25-2`, … | `…-v2026.5.25-1` | `2026.5.25` already on npm; bugfix or republish same day |

**Important:** npm requires [valid semver](https://docs.npmjs.com/about-semantic-versioning). Use a **hyphen** prerelease segment (`2026.5.25-1`), not a fourth dot (`2026.5.25.1` — npm rejects or mangles it).

- Micro **`N`** starts at **`1`** (there is no `2026.5.25-0` on npm).
- Tags must match `package.json` **exactly** (including the hyphen).
- Pin exact versions in dependents (no `^` / `~`):

```json
"@clanker-chain/mqtt-tools": "2026.5.25-2"
```

If the **calendar day** changes (e.g. fix ships May 26), bump to a new date (`2026.5.26`) instead of micro on the previous day.

## Tag format

Git tags must match `package.json` exactly:

| Package | Tag example |
|---------|-------------|
| `@clanker-chain/identity-node-client` | `identity-node-client-v2026.5.23` |
| `@clanker-chain/mqtt-node-client` | `mqtt-node-client-v2026.5.25-2` |
| `@clanker-chain/mqtt-channel-plugin` | `mqtt-channel-plugin-v2026.5.26` |
| `@clanker-chain/mqtt-tools` | `mqtt-tools-plugin-v2026.5.26` (pins `mqtt-node-client@2026.5.25-2`) |
| `@clanker-chain/mqtt-plugin` | `mqtt-plugin-v2026.5.23` |
| `@clanker-chain/identity-plugin` | `identity-plugin-v2026.5.23` |

## Inter-package dependencies

Pin **exact** CalVer (including micro when used):

```json
"@clanker-chain/identity-node-client": "2026.5.23",
"@clanker-chain/mqtt-node-client": "2026.5.25-2",
"@clanker-chain/mqtt-channel-plugin": "2026.5.26",
"@clanker-chain/mqtt-tools": "2026.5.26"
```

## Publish order

1. `@clanker-chain/identity-node-client`
2. `@clanker-chain/mqtt-node-client` — **`2026.5.25-2`** (`poll()` listener-leak fix; `publishAck`, `clean`)
3. `@clanker-chain/mqtt-channel-plugin` — **`2026.5.26`** (pins `mqtt-node-client@2026.5.25-2`; channel outbound uses `publishAck`)
4. `@clanker-chain/mqtt-tools` — **`2026.5.26`** (pins `mqtt-node-client@2026.5.25-2`; requires channel + `channels.mqtt`)
5. `@clanker-chain/mqtt-plugin`
6. `@clanker-chain/identity-plugin` (deprecated; superseded by identity-node-client)

Wait for npm registry propagation between steps when installing published deps in CI.

## Non-npm services

`identity-service`, `mqtt-auth-service`, and `clanker-cli` use the same CalVer string in their `package.json` for traceability; they are deployed from the repo or Docker, not published to npm.

## Release notes

Document wire breaking changes explicitly (MQTT auth, key file format, `signature_scheme`, identity write path). For micro releases, note what changed since the same-day base (`2026.5.25` → `2026.5.25-1`).
