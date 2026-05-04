# clanker-chain — Foundry (`chain/`)

Solidity registry for operator and bot identities. Used with **Anvil** locally and (later) Base for public-good deployment.

## Prerequisites

Install [Foundry](https://book.getfoundry.sh/getting-started/installation):

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Confirm `forge`, `cast`, and `anvil` are on your `PATH`.

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

## Repo integration

- CI runs `forge test` in `chain/` when `forge` is available (see [`scripts/ci-local.sh`](../scripts/ci-local.sh)).
- High-level roadmap: [`docs/blockchain-identity-plan.md`](../docs/blockchain-identity-plan.md).
