# Operator CLI

Profile-aware operator tooling for `ClankerIdentity`: mint, whoami, list bots, revoke/rotate, and transfer. Agents can drive these once `~/.clanker` exists. Prefer **`clanker setup`** for humans; use `clanker init --preset` for scripts.

Low-level aliases (`clanker chain mint-*`) remain. This CLI does **not** include a join site or MQTT message monitoring.

## Quick start (Sepolia closed beta)

```bash
npm install -g @clanker-chain/clanker-cli@2026.9.7-2

clanker setup
# guided: preset, owner address, operator label, optional key pointer
# detects Foundry account names + ~/.openclaw/keys (context only)

clanker whoami          # works from operator.json owner (read-only)
clanker operator mint org.you --key-file ~/.clanker/op.key   # if not registered yet
clanker bot mint you.laptop
```

Non-interactive (agents / CI):

```bash
clanker setup --preset sepolia \
  --operator org.you \
  --address 0x… \
  --key-file ~/.clanker/op.key \
  --yes --force
```

From a monorepo checkout (dev / `chain up|deploy`): `node clanker-cli/bin/clanker.mjs …`. `chain up`, `chain deploy`, and `check *` require the git checkout; they are not available from the npm tarball alone.

`bot mint` prints a `channels.mqtt` stub filled from the preset (broker, auth, RPC, registry). Point OpenClaw (or a future MCP) at that stub and the key file path it reports.

Closed-beta hub values live in the **sepolia** preset (same numbers as [`public-testnet-hub.md`](public-testnet-hub.md)). Do not put those hostnames in plugin npm READMEs until hub step 4 (ACLs).

## `clanker setup`

Interactive (TTY) wizard that:

1. Detects existing `config.json` / `operator.json`, `OPERATOR_PRIVATE_KEY` (address only), Foundry `cast wallet list` names, and OpenClaw bot key basenames.
2. Chooses preset (`sepolia` / `local`). On Sepolia, offers `fromBlock` **46000000** for faster public-RPC scans (registry floor remains 35000000).
3. Sets operator **owner address** + **label**.
4. Verifies on-chain: refuses Anvil `#0` on public RPC; refuses saving if the label’s current owner ≠ chosen address.
5. Optionally stores a signing **pointer** (`keyFile` or `OPERATOR_PRIVATE_KEY`). Omit for a read-only profile — `whoami` / `bots` still work; mint/revoke need a key later.

Never stores raw hex keys. Foundry passwords are not unlocked or saved; paste the address (or unlock via `cast` yourself). Bot keys are not the operator owner.

`clanker init --preset …` remains the non-interactive network-only writer.

## Profile layout

| Path | Role |
|------|------|
| `~/.clanker/config.json` | Network: `preset`, `registryAddress`, `chainRpcUrl`, `brokerUrl`, `mqttAuthServiceUrl`, `fromBlock` |
| `~/.clanker/operator.json` | `label`, `owner`, optional key **pointer** (`env` or `keyFile`) — never a raw hex key |
| `~/.clanker/keys/{bot}.key` | Bot signing key (symlink or copy) |
| `~/.openclaw/keys/{bot}.key` | Same key — primary path for published OpenClaw plugins today |

Override home with `CLANKER_HOME`. Override bot key directory with `CLANKER_KEY_DIR` (defaults to `$CLANKER_HOME/keys`).

Bot labels are used as filenames: no `/`, `\`, `..`, NUL, or empty strings.

```bash
clanker init --preset local [--force] [--registry 0x…]
clanker init --preset sepolia [--force]
```

`local` leaves `registryAddress` null until you deploy; pass `--registry` after `clanker chain deploy`, or set `REGISTRY_ADDRESS`.

## Anvil guard

Mutating commands (and `clanker chain deploy`) resolve the operator key as:

1. `--key`
2. `--key-file`
3. `OPERATOR_PRIVATE_KEY`
4. Profile `keyFile` pointer
5. Profile `env` pointer
6. **Anvil account #0** — **only** when the RPC host is `localhost` / `127.0.0.1`

On any other RPC, missing key or Anvil #0 → hard error. After mint / transfer accept, `operator.json` stores the pointer that matched (`keyFile` path or `OPERATOR_PRIVATE_KEY`). Raw `--key` cannot be re-read later — prefer `--key-file` or exporting `OPERATOR_PRIVATE_KEY`.

**Reads** (`whoami`, `bots`): `--address` → signing key if present → `operator.json` `owner` → error pointing at `clanker setup`.

## Ownership discovery

- **Preferred label** (`--operator` or `operator.json`): `operators(keccak(label))` storage read. Works after `OperatorTransferred`. Rejects wrong owner or revoked.
- **Full list** (`whoami` without preferred): chunked `eth_getLogs` (2000-block windows, same idea as `identity-service`) for `OperatorRegistered` (by owner) and `OperatorTransferred` (by `newOwner`), then storage refresh so only the **current** owner is listed. `fromBlock` is a scan floor, not a substitute for chunking.

## Commands

| Command | Behavior |
|---------|----------|
| `clanker setup …` | Interactive or flagged profile wizard |
| `clanker whoami [--json] [--operator <label>] [--address 0x…]` | Current operators for address (+ child bots) |
| `clanker operator mint <label>` | `registerOperator`; writes `operator.json` after receipt |
| `clanker bot mint <label> [operator]` | Infers operator from profile / sole active operator if omitted; dual-writes keys; prints harness stub |
| `clanker bots [--json] [--operator] [--address]` | Bots for the inferred (or preferred) label; `--address` is read-only |
| `clanker bot status <label>` | Storage read of `bots(id)` |
| `clanker bot revoke \| rotate` | Same txs as `chain revoke-bot` / `rotate-bot-key` |
| `clanker operator transfer propose <label> <newOwner>` | `proposeOperatorTransfer` |
| `clanker operator transfer accept <label>` | `acceptOperatorTransfer`; refreshes `operator.json` after receipt |

Human output by default. Pass `--json` for agents/scripts. `clanker chain mint-*` still prints JSON always.

## Key resolution for agents

Once a human (or CI) has written `~/.clanker` and (for mutates) exported `OPERATOR_PRIVATE_KEY` or a `keyFile` pointer:

```bash
clanker whoami --json
clanker bot mint agent.session-1 --json
```

Do not ask the model to invent `--registry` / `--rpc` / operator labels if the profile already answers them.

## What this CLI does **not** monitor

| Question | Covered? |
|----------|----------|
| Do I own this bot? Revoked? | Yes — registry |
| When minted / current `botKey`? | Yes — registry + events |
| Is it CONNECT’d right now? | No — needs MQTT status subscribe (later) |
| What did it say to peers? | No — needs privileged MQTT read (later) |
| What did the model do on disk? | No — harness journals only |

## Related

- Local Anvil + hub: [`SETUP.md`](../SETUP.md)
- Public hub stranger path: [`public-testnet-hub.md`](public-testnet-hub.md)
- Fees: [`registration-economics.md`](registration-economics.md)
- Wire protocol: [`bot-comms.md`](../bot-comms.md)

Env-file helper for power users: [`clanker-cli/scripts/with-sepolia-env.sh`](../clanker-cli/scripts/with-sepolia-env.sh). Prefer `clanker setup` for day-to-day onboarding.
