# clanker-chain — Foundry (`chain/`)

Solidity registry for operator and bot identities. This contract is the **public-good Facts layer**: other products pin `(chainId, registryAddress)` and do not need this repo’s MQTT hub. Used with **Anvil** locally, Base Sepolia for rehearsal, and (later) Base mainnet for a real sunk-cost namespace.

**Facts · Policy · Transport** — `ClankerIdentity` is **Facts** only (owner, `botKey`, revoke). Do not add allow-lists, pairing, metadata, or reputation here. Those belong in products. Registration fees are a sunk-cost filter, not abuse protection. → [`docs/trust-model.md`](../docs/trust-model.md), [`docs/registration-economics.md`](../docs/registration-economics.md)

## Prerequisites

Install [Foundry](https://book.getfoundry.sh/getting-started/installation):

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Confirm `forge`, `cast`, and `anvil` are on your `PATH`.

**First clone:** this repo uses a git submodule for `forge-std`:

```bash
git clone --recurse-submodules <repo-url>
# or, after a clone without submodules:
git submodule update --init chain/lib/forge-std
```

## Tests

From repo root or this directory:

```bash
cd chain
forge test -vvv
```

## Local chain (LAN)

Start Anvil bound to all interfaces so other machines on your network can use the same RPC:

```bash
anvil --host 0.0.0.0 --port 8545 --state ./.anvil-state.json
```

Or use the repo CLI from the **repository root** (no global install required):

```bash
node packages/clanker-cli/bin/clanker.mjs chain up --host 0.0.0.0 --port 8545
```

To use the bare `clanker` command, either install the package globally from this repo (`npm install -g ./clanker-cli`) or link it once (`cd clanker-cli && npm link`), then ensure the directory that contains the `clanker` shim is on your `PATH`.

## Deploy registry (Anvil default account)

The constructor requires immutable parameters: `(operatorFee, botFee, feeRecipient, priorRegistry)`. Set these env vars before deploy:

| Variable | Description |
|----------|-------------|
| `OPERATOR_FEE_WEI` | Wei sent with each `registerOperator` (exact match required) |
| `BOT_FEE_WEI` | Wei sent with each `registerBot` |
| `FEE_RECIPIENT` | Address that receives fees on each registration (non-zero) |
| `PRIOR_REGISTRY` | Optional. Predecessor `ClankerIdentity` on **this** chain, or unset / `0x0` for genesis. Successors walk this so prior labels cannot be usurped. |

**Local dev example** (tiny nonzero fees):

```bash
export OPERATOR_FEE_WEI=1000000000000000    # 0.001 ETH
export BOT_FEE_WEI=100000000000000          # 0.0001 ETH
export FEE_RECIPIENT=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266  # Anvil account #0
```

Anvil’s first test account (well-known private key — **dev only**, never on mainnet):

```bash
cd chain
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast \
  -vvv
```

From repo root via CLI (export the three fee env vars first):

```bash
node packages/clanker-cli/bin/clanker.mjs chain deploy --rpc http://127.0.0.1:8545
```

The script logs: `ClankerIdentity deployed at: 0x…`, plus `operatorFee`, `botFee`, and `feeRecipient`.

### Registration fees

- Fees are **immutable** (constructor args). There is no `setFee` or owner.
- `registerOperator` and `registerBot` are **payable**; `msg.value` must equal `operatorFee` / `botFee` exactly or the tx reverts `WrongFee`.
- Fees are **forwarded to `feeRecipient`** on each successful register. Revoke does not refund.
- `rotateBotKey`, `revokeBot`, and operator transfer/revoke are **not** charged.

Read on-chain fee config:

```bash
cast call $REGISTRY "operatorFee()(uint256)" --rpc-url $CHAIN_RPC_URL
cast call $REGISTRY "botFee()(uint256)" --rpc-url $CHAIN_RPC_URL
cast call $REGISTRY "feeRecipient()(address)" --rpc-url $CHAIN_RPC_URL
```

See [`docs/registration-economics.md`](../docs/registration-economics.md) for fee rationale and [`docs/registry-lifecycle.md`](../docs/registry-lifecycle.md) for pins and no-usurpation.

## Read contract state with `cast`

After deploy, read the zero slot (no operator registered yet — all fields zero):

```bash
cast call $REGISTRY "operators(bytes32)(address,uint64,uint64)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  --rpc-url http://127.0.0.1:8545
```

Replace `$REGISTRY` with the deployed address from the deploy output. For a registered label, compute `bytes32 id = keccak256(bytes(label))` in Solidity (same value as `keccak256(abi.encodePacked(label))` for a string) and pass that `id` as the argument.

## Register operators and bots (`cast`)

Until `clanker chain mint-operator` / `mint-bot` exist, use **`cast send`**. Or use the repo CLI (CalVer `2026.5.23`):

```bash
export REGISTRY=0x5FbDB2315678afecb367f032d93F642f64180aa3
export CHAIN_RPC_URL=http://127.0.0.1:8545

node packages/clanker-cli/bin/clanker.mjs chain mint-operator org.openclaw.pat --registry "$REGISTRY"
node packages/clanker-cli/bin/clanker.mjs chain mint-bot openclaw.france.prod-1 org.openclaw.pat --registry "$REGISTRY"
```

**Note:** `registerOperator` / `registerBot` require `msg.value` matching on-chain fees. The CLI reads fees from the contract automatically; for manual `cast send`, use `--value` as shown below.

### Operator id vs private key

- **`OP_ID`** = `cast keccak $(cast from-utf8 "org.openclaw.pat")` — a **`bytes32`** chain id, **not** a wallet secret.
- **`PK`** = a real **32-byte hex private key** (e.g. Anvil account #0: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`). Using `OP_ID` as `PK` derives a random address with **0 ETH** → `Out of gas: gas required exceeds allowance: 0`.

### Register one operator

Must be sent from the key that should **own** the operator (funded account on Anvil):

```bash
export REGISTRY=0x5FbDB2315678afecb367f032d93F642f64180aa3   # your deployed address

cast send --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --value "$(cast call "$REGISTRY" "operatorFee()(uint256)" --rpc-url http://127.0.0.1:8545)" \
  "$REGISTRY" \
  "registerOperator(string)" \
  "org.openclaw.pat"
```

### Register a bot under that operator

```bash
export OP_ID=$(cast keccak $(cast from-utf8 "org.openclaw.pat"))

cast send --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --value "$(cast call "$REGISTRY" "botFee()(uint256)" --rpc-url http://127.0.0.1:8545)" \
  "$REGISTRY" \
  "registerBot(bytes32,string,address)" \
  "$OP_ID" \
  "openclaw.france.prod-1" \
  0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

The last argument is the **`botKey`** (20-byte address). Use a **different** funded address per bot; `ClankerIdentity` rejects duplicate active keys.

### Second operator from another Anvil account

Use a **different** `--private-key` (e.g. Anvil #2) for `registerOperator("org.openclaw.alice")`, then the **same** key for that operator’s `registerBot` calls.

### Verify

```bash
export BOT_ID=$(cast keccak $(cast from-utf8 "openclaw.france.prod-1"))
cast call "$REGISTRY" "bots(bytes32)(bytes32,address,uint64,uint64)" "$BOT_ID" --rpc-url http://127.0.0.1:8545
```

### Wired to MQTT auth (chain-direct)

**mqtt-auth-service** and OpenClaw bots read `ClankerIdentity` over RPC (`CHAIN_RPC_URL` + `REGISTRY_ADDRESS`) via `@clanker-chain/identity-node-client` `RegistryClient`.

```bash
cd hub/mqtt-service
export CHAIN_RPC_URL=http://127.0.0.1:8545
export REGISTRY_ADDRESS=$REGISTRY
docker compose build mqtt-auth && docker compose up -d
```

See [`docs/archive/blockchain-identity-plan.md`](../docs/archive/blockchain-identity-plan.md) for historical migration notes.

## Repo integration

- CI runs `forge test` in `chain/` when `forge` is available (see [`scripts/ci-local.sh`](../scripts/ci-local.sh)).
- Historical roadmap (archive): [`docs/archive/blockchain-identity-plan.md`](../docs/archive/blockchain-identity-plan.md).
