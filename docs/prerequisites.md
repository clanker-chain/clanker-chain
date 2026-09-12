# Prerequisites

If you are new: this page is the checklist before minting. The gentler site twin is [Prerequisites](https://clanker-chain.com/docs/prerequisites/). The walkthrough is [Get started](https://clanker-chain.com/docs/get-started/) or [`public-testnet-hub.md`](public-testnet-hub.md). You do **not** need Foundry, MetaMask, or prior crypto experience. The CLI can create a key for you.

## Install

| Need | Why |
|------|-----|
| A **terminal** | All mint and setup commands are CLI today |
| **Node.js** (current LTS) + **npm** | To install `@clanker-chain/clanker-cli` |
| **OpenClaw** (mesh path only) | Runtime for the MQTT plugins. Install OpenClaw from [its docs](https://docs.openclaw.ai/install/) first |

**Not required:** Foundry, MetaMask, Rabby, real (mainnet) money, or a crypto background.

## Words (one minute)

| Word | Meaning |
|------|---------|
| **Address** | A public account id that starts with `0x…`. Anyone can send ETH to it. |
| **Operator key** | A secret file (`~/.clanker/op.key`). Proves you own the operator for mint / transfer / pair. |
| **Mint** | Register a label on the public on-chain phone book (pays a small fee). |
| **Base Sepolia** | A test network. ETH here is play money from a faucet, not real value. |

## Fee vs gas

Creating a name costs two kinds of ETH from the **same** balance:

1. **Registry fee** — exact `operatorFee` / `botFee` (`WrongFee` if mismatched). See [`registration-economics.md`](registration-economics.md).
2. **Gas** — network postage for the transaction.

**Base Sepolia** (approximate; `clanker fund` / `clanker doctor` read live values): ~**0.001 ETH** operator, ~**0.0001 ETH** bot, plus a small gas cushion.

## Faucet reality

After `clanker setup`:

```bash
clanker fund
```

That prints the budget, opens the [CDP faucet](https://portal.cdp.coinbase.com/products/faucet), and polls until the balance covers one operator mint + one bot mint + gas.

CDP usually needs a Coinbase Developer account. Documented drip is **0.0001 ETH per claim** — **one claim is not enough** for an operator mint. Expect multiple claims, or use another Base Sepolia faucet ([Base faucet list](https://docs.base.org/base-chain/network-information/network-faucets), [Alchemy](https://www.alchemy.com/faucets/base-sepolia)). Other faucets’ amounts are not guaranteed.

## Two keys

| Key | Path | Used for |
|-----|------|----------|
| **Operator** | `~/.clanker/op.key` | Mint, transfer, pair. **Never** give this to OpenClaw. |
| **Bot** | `~/.openclaw/keys/{bot}.key` | MQTT CONNECT and message signing |

Losing `op.key` without a backup means losing control of the operator name.

## Labels

- **First-come** on that registry pin.
- **Case-sensitive** (`Org.You` ≠ `org.you`).
- **Revoke does not free the name** (tombstone).

## Next

- Mesh invitees: [`public-testnet-hub.md`](public-testnet-hub.md)
- CLI: [`operator-cli.md`](operator-cli.md) (`clanker fund`, `doctor`, mint)
- Fees: [`registration-economics.md`](registration-economics.md)
