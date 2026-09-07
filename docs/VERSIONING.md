# Versioning (CalVer)

All `@clanker-chain/*` npm packages use **calendar versioning** tied to release date:

- Format: **`YYYY.M.D`** (npm-normalized; e.g. release on 2026-07-29 → **`2026.7.29`**)
- Any wire-format or crypto breaking change requires a **new date version** (no semver major/minor semantics)

## Same-day micro releases

When you need **more than one npm publish of the same package on the same calendar day**, use a **micro** suffix:

| Kind | npm `version` | Git tag suffix | When |
|------|----------------|----------------|------|
| First release that day | `2026.7.29` | `…-v2026.7.29` | First publish on that calendar day |
| Micro (same day) | `2026.7.29-1`, `2026.7.29-2`, … | `…-v2026.7.29-1` | Base version already on npm; bugfix or republish same day |

**Important:** npm requires [valid semver](https://docs.npmjs.com/about-semantic-versioning). Use a **hyphen** prerelease segment (`2026.7.29-1`), not a fourth dot (`2026.7.29.1` — npm rejects or mangles it).

- Micro **`N`** starts at **`1`** (there is no `2026.7.29-0` on npm).
- Tags must match `package.json` **exactly** (including the hyphen).
- Pin exact versions in dependents (no `^` / `~`):

```json
"@clanker-chain/mqtt-tools": "2026.7.29"
```

If the **calendar day** changes, bump to a new date instead of micro on the previous day.

## Tag format

Git tags must match `package.json` exactly:

| Package | Tag example |
|---------|-------------|
| `@clanker-chain/identity-node-client` | `identity-node-client-v2026.7.29` |
| `@clanker-chain/mqtt-node-client` | `mqtt-node-client-v2026.5.25-2` |
| `@clanker-chain/mqtt-channel-plugin` | `mqtt-channel-plugin-v2026.7.29` |
| `@clanker-chain/mqtt-tools` | `mqtt-tools-plugin-v2026.7.29` |

**Deprecated — do not tag for new publishes:** `@clanker-chain/mqtt-plugin`, `@clanker-chain/identity-plugin`. Use channel + tools + `identity-node-client` instead.

## Inter-package dependencies

Pin **exact** CalVer (including micro when used):

```json
"@clanker-chain/identity-node-client": "2026.7.29",
"@clanker-chain/mqtt-node-client": "2026.5.25-2",
"@clanker-chain/mqtt-channel-plugin": "2026.7.29",
"@clanker-chain/mqtt-tools": "2026.7.29"
```

Before tagging channel/tools, replace any `file:` pins on `identity-node-client` with the published CalVer above. Until then, install plugins from a local checkout (see [`SETUP.md`](../SETUP.md)) — do **not** run `openclaw plugins install @…@2026.7.29` against npm.

## Publish order

1. `@clanker-chain/identity-node-client` — **`2026.7.29`** (chain-direct `RegistryClient`)
2. `@clanker-chain/mqtt-node-client` — **`2026.5.25-2`** (already published; republish only if the client changes)
3. `@clanker-chain/mqtt-channel-plugin` — **`2026.7.29`** (pins `identity-node-client@2026.7.29`, `mqtt-node-client@2026.5.25-2`)
4. `@clanker-chain/mqtt-tools` — **`2026.7.29`** (same pins; requires channel + `channels.mqtt`)

Wait for npm registry propagation between steps when installing published deps in CI.

## Non-npm services

`identity-service` (deprecated), `mqtt-auth-service`, and `clanker-cli` use the same CalVer string in their `package.json` for traceability; they are deployed from the repo or Docker, not published to npm.

## Release notes

Document wire breaking changes explicitly (MQTT auth, key file format, `signature_scheme`, identity read path). For micro releases, note what changed since the same-day base (`2026.7.29` → `2026.7.29-1`).
