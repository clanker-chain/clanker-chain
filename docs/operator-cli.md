# Operator CLI

Profile-aware operator tooling for `ClankerIdentity`: mint, whoami, list bots, revoke/rotate, and transfer. Agents can drive these once `~/.clanker` exists. Prefer **`clanker setup`** for humans; use `clanker init --preset` for scripts.

**Facts · Policy · Transport** — Mint / revoke write **Facts**. `clanker pair` writes **Policy** (hub pairing store + local `allowOperators`). Hub `/acl` is **Transport**. → [`trust-model.md`](trust-model.md)

Low-level aliases (`clanker chain mint-*`) remain. This CLI does **not** include a join site or MQTT message monitoring.

## Quick start (experimental Sepolia)

No wallet experience needed. Hub + invite onboarding: [`public-testnet-hub.md`](public-testnet-hub.md). For local Anvil, see [`SETUP.md`](../SETUP.md).

```bash
npm install -g @clanker-chain/clanker-cli@2026.9.10

clanker setup
# Choose: "Create a new operator key for me" → note the 0x address
# Fund it: https://portal.cdp.coinbase.com/products/faucet (Base Sepolia → ETH)

clanker doctor
clanker whoami
clanker operator mint org.you --yes
clanker bot mint you.laptop --yes
# Both sides before DMs deliver:
clanker pair add org.openclaw.pat --yes
```

Non-interactive (agents / CI):

```bash
clanker setup --preset sepolia \
  --operator org.you \
  --generate-key \
  --yes --force
```

From a monorepo checkout (dev / `chain up|deploy`): `node packages/clanker-cli/bin/clanker.mjs …`. `chain up`, `chain deploy`, and `check *` require the git checkout; they are not available from the npm tarball alone.

`bot mint` writes the **bot** key under `~/.openclaw/keys/`, wires `channels.mqtt` (including `privateKeyFile`), prints a **Bot identity** card (do not hand OpenClaw `op.key`), then plugin + peer allowlist steps.

Closed-beta hub values live in the **sepolia** preset (same numbers as [`public-testnet-hub.md`](public-testnet-hub.md)). Do not put those hostnames in plugin npm READMEs until hub step 4 (ACLs).

## `clanker setup`

Interactive (TTY) wizard powered by **`@clack/prompts`** + **`picocolors`**:

1. Detects existing `config.json` / `operator.json`, env key (address only), Foundry accounts, and OpenClaw bot key basenames (table).
2. Chooses preset (`sepolia` / `local`). Sepolia defaults `fromBlock` to **46000000**.
3. **Owner identity** — default: create `~/.clanker/op.key`. Also: existing key file, Foundry (advanced), or paste address (read-only).
4. Operator **label** (e.g. `org.you`).
5. Verifies on-chain: refuses Anvil `#0` on public RPC; refuses saving if the label’s current owner ≠ chosen address.
6. Stores a signing **pointer** (`keyFile` or `OPERATOR_PRIVATE_KEY`) when a key was chosen.

Never stores raw hex keys inside JSON. Flag parity: `--preset`, `--operator`, `--generate-key`, `--address`, `--key-file`, `--foundry-account`, `--export-key`, `--skip-key`, `--yes`, `--force`.

### Advanced: Foundry / existing wallet

```bash
clanker setup --preset sepolia --operator org.you \
  --foundry-account YOUR_ACCOUNT --export-key --yes --force
# or:
clanker setup --preset sepolia --operator org.you \
  --address 0x… --key-file ~/.clanker/op.key --yes --force
```

Optional GUI: import `op.key` into MetaMask/Rabby to view the address — not required for mint.

## `clanker doctor`

Prints the detection table plus pass/warn/fail checks (including `GET mqttAuthServiceUrl/health` when configured). Exit `0` if ready for `whoami`. `--json` for agents. Suggests next commands.

## Mutates (plan → confirm)

`operator mint`, `bot mint` / `revoke` / `rotate`, `operator transfer *`, and `pair add` print a plan and confirm on a TTY unless `--yes` or `--json`. Success paths print a **Next:** hint.

## Reads

- `whoami` uses profile owner when no key; does **not** scan bot logs unless `--with-bots`.
- Prefer `clanker bots` for bot listings.

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
- **Full list** (`whoami` without preferred): chunked `eth_getLogs` (2000-block windows) for `OperatorRegistered` (by owner) and `OperatorTransferred` (by `newOwner`), then storage refresh so only the **current** owner is listed. `fromBlock` is a scan floor, not a substitute for chunking.

## Commands

| Command | Behavior |
|---------|----------|
| `clanker setup …` | Interactive or flagged profile wizard (Clack) |
| `clanker doctor [--json]` | Local readiness checks |
| `clanker whoami [--json] [--operator <label>] [--address 0x…] [--with-bots]` | Operators for address; bots only with `--with-bots` |
| `clanker operator mint <label>` | `registerOperator`; writes `operator.json` after receipt |
| `clanker bot mint <label> [operator]` | Infers operator; writes bot key + openclaw `channels.mqtt`; prints Bot identity card |
| `clanker bots [--json] [--operator] [--address]` | Bots for the inferred (or preferred) label; `--address` is read-only |
| `clanker bot status <label>` | Storage read of `bots(id)` |
| `clanker bot revoke \| rotate` | Same txs as `chain revoke-bot` / `rotate-bot-key` |
| `clanker pair add \| remove <operator>` | Policy: allow-list peer on mqtt-auth; syncs `allowOperators` (`--auth-url`, `--openclaw-home DIR` for non-default OpenClaw config) |
| `clanker pair list \| status` | List allows / check mutual (`--auth-url`) |
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
- Wire protocol: [`bot-comms.md`](bot-comms.md)
- Docs index: [`README.md`](README.md)

Env-file helper for power users: [`packages/clanker-cli/scripts/with-sepolia-env.sh`](../packages/clanker-cli/scripts/with-sepolia-env.sh). Prefer `clanker setup` for day-to-day onboarding.
