# clanker-chain — Foundry (`chain/`)

Solidity registry for operator and bot identities. Used with **Anvil** locally and (later) Base for public-good deployment.

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
node clanker-cli/bin/clanker.mjs chain up --host 0.0.0.0 --port 8545
```

To use the bare `clanker` command, either install the package globally from this repo (`npm install -g ./clanker-cli`) or link it once (`cd clanker-cli && npm link`), then ensure the directory that contains the `clanker` shim is on your `PATH`.

## Deploy registry (Anvil default account)

Anvil’s first test account (well-known private key — **dev only**, never on mainnet):

```bash
cd chain
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast \
  -vvv
```

From repo root via CLI:

```bash
node clanker-cli/bin/clanker.mjs chain deploy --rpc http://127.0.0.1:8545
```

The script logs: `ClankerIdentity deployed at: 0x…`

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

node clanker-cli/bin/clanker.mjs chain mint-operator org.openclaw.pat --registry "$REGISTRY"
node clanker-cli/bin/clanker.mjs chain mint-bot openclaw.france.prod-1 org.openclaw.pat --registry "$REGISTRY"
```

Legacy **`cast send`** examples below remain valid.

### Operator id vs private key

- **`OP_ID`** = `cast keccak $(cast from-utf8 "org.openclaw.pat")` — a **`bytes32`** chain id, **not** a wallet secret.
- **`PK`** = a real **32-byte hex private key** (e.g. Anvil account #0: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`). Using `OP_ID` as `PK` derives a random address with **0 ETH** → `Out of gas: gas required exceeds allowance: 0`.

### Register one operator

Must be sent from the key that should **own** the operator (funded account on Anvil):

```bash
export REGISTRY=0x5FbDB2315678afecb367f032d93F642f64180aa3   # your deployed address

cast send --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  "$REGISTRY" \
  "registerOperator(string)" \
  "org.openclaw.pat"
```

### Register a bot under that operator

```bash
export OP_ID=$(cast keccak $(cast from-utf8 "org.openclaw.pat"))

cast send --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
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

### Wired to identity-service and MQTT

On-chain events are indexed by **identity-service** (`EvmBackend`) into a materialized snapshot at `identity/bot-identity-ledger.json`. **mqtt-auth-service** verifies SIWE CONNECT passwords against `secp256k1-eth` / `botKey` from `GET /v1/bots/:id`.

Run identity-service with:

```bash
CHAIN_RPC_URL=http://127.0.0.1:8545 \
REGISTRY_ADDRESS=$REGISTRY \
bun run identity-service/src/server.ts
```

See [`identity/SERVICE.md`](../identity/SERVICE.md) and [`docs/blockchain-identity-plan.md`](../docs/blockchain-identity-plan.md).

## Repo integration

- CI runs `forge test` in `chain/` when `forge` is available (see [`scripts/ci-local.sh`](../scripts/ci-local.sh)).
- High-level roadmap: [`docs/blockchain-identity-plan.md`](../docs/blockchain-identity-plan.md).
