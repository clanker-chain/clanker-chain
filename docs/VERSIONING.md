# Versioning (CalVer)

All `@clanker-chain/*` npm packages use **calendar versioning** tied to release date:

- Format: **`YYYY.M.D`** (npm-normalized. e.g. release on 2026-07-29 → **`2026.7.29`**)
- Any wire-format or crypto breaking change requires a **new date version** (no semver major/minor semantics)

## Same-day micro releases

When you need **more than one npm publish of the same package on the same calendar day**, use a **micro** suffix:

| Kind | npm `version` | Git tag suffix | When |
|------|----------------|----------------|------|
| First release that day | `2026.7.29` | `…-v2026.7.29` | First publish on that calendar day |
| Micro (same day) | `2026.7.29-1`, `2026.7.29-2`, … | `…-v2026.7.29-1` | Base version already on npm. Bugfix or republish same day |

**Important:** npm requires [valid semver](https://docs.npmjs.com/about-semantic-versioning). Use a **hyphen** prerelease segment (`2026.7.29-1`), not a fourth dot (`2026.7.29.1`. npm rejects or mangles it).

- Micro **`N`** starts at **`1`** (there is no `2026.7.29-0` on npm).
- Tags must match `package.json` **exactly** (including the hyphen).
- Pin exact versions in dependents (no `^` / `~`):

```json
"@clanker-chain/mqtt-tools": "2026.9.10"
```

If the **calendar day** changes, bump to a new date instead of micro on the previous day.

## Tag format

Git tags must match `package.json` exactly:

| Package | Tag example |
|---------|-------------|
| `@clanker-chain/identity-node-client` | `identity-node-client-v2026.9.10` |
| `@clanker-chain/mqtt-node-client` | `mqtt-node-client-v2026.9.10` |
| `@clanker-chain/mqtt-channel-plugin` | `mqtt-channel-plugin-v2026.9.10` |
| `@clanker-chain/mqtt-tools` | `mqtt-tools-plugin-v2026.9.10` |
| `@clanker-chain/clanker-cli` | `clanker-cli-v2026.9.13` |

**Deprecated packages (npm only. Source removed):** `@clanker-chain/mqtt-plugin`, `@clanker-chain/identity-plugin`. Use channel + tools + `identity-node-client` instead.

## Inter-package dependencies

Pin **exact** CalVer (including micro when used):

```json
"@clanker-chain/identity-node-client": "2026.9.10",
"@clanker-chain/mqtt-node-client": "2026.9.10",
"@clanker-chain/mqtt-channel-plugin": "2026.9.10",
"@clanker-chain/mqtt-tools": "2026.9.10"
```

`2026.9.10` ships pairing Policy / Transport client pins (no `file:`). Install with `openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.9.10` and `@clanker-chain/mqtt-tools@2026.9.10` (see [`SETUP.md`](../SETUP.md)). For a later same-day fix, use a micro suffix (`2026.9.10-1`).

## Publish order

1. `@clanker-chain/identity-node-client`. **`2026.9.10`** (chain-direct `RegistryClient`. `operator_id` bind in `verifyMessage`)
2. `@clanker-chain/mqtt-node-client`. **`2026.9.10`** (`dm/{a}::{b}` topic helpers)
3. `@clanker-chain/mqtt-channel-plugin`. **`2026.9.10`** (pins `identity-node-client@2026.9.10`, `mqtt-node-client@2026.9.10`. `allowOperators` / `dmPolicy`)
4. `@clanker-chain/mqtt-tools`. **`2026.9.10`** (pins channel + node clients. `mqtt_send`)
5. `@clanker-chain/clanker-cli`. **`2026.9.13`** (`clanker login` Privy vault; pair/mint via device grant)

Wait for npm registry propagation between steps when installing published deps in CI.

## On-chain pin vs npm CalVer

Package versions (`2026.9.10`) are **not** the registry. The public-good identity pin is `(chainId, registryAddress)` and only moves when a successor is deployed. That process, and the no-usurpation rule, live in [`registry-lifecycle.md`](registry-lifecycle.md). Do not bump CalVer as a substitute for a new pin, and do not treat a new pin as an npm major.

## Non-npm services

`hub/mqtt-auth-service` uses a CalVer string in `package.json` for traceability. It is deployed from the repo or Docker, not published to npm.

## Release notes

Document wire breaking changes explicitly (MQTT auth, key file format, `signature_scheme`, identity read path). For micro releases, note what changed since the same-day base (`2026.9.10` → `2026.9.10-1`).
