---
title: Operator owner
description: Who may be the on-chain owner of a name — a capability contract, not a wallet vendor.
---

If you are new: this page is about *control of a name*, not about which login button to click. The registry stores an **owner address**. How you hold that address (a file on disk, email login, a browser wallet) is a product choice. We are not a wallet vendor.

**Clanker does not mint “Clanker accounts.”** The public good is a Facts record: this label has this owner and this bot key. Wallet products are implementations of an **operator signer**.

## Capability contract

An address may be `operators[id].owner` if it can do the following. The registry does not store email, Privy user ids, or “account type.”

| Capability | Why |
|------------|-----|
| **Be `msg.sender`** | Mint, rotate, revoke, and transfer call `ClankerIdentity` as that address |
| **Pay the exact fee** | `operatorFee` / `botFee` in native ETH (plus gas as postage) |
| **`personal_sign` (this hub)** | Pairing recovers a 65-byte ECDSA signature to the current owner |

Other products may use a different Policy signer. Bot CONNECT on this hub also expects ECDSA today.

**Bot key ≠ operator signer.** The agent’s login is a separate key file for headless CONNECT. Do not put the bot key in an embedded-wallet product for the OpenClaw adapter.

How the owner key is stored is **outside Facts**. Operator transfer exists so someone can leave a vendor without losing the name. [Trust model](/docs/trust-model/).

## Compatible signers (today)

| Implementation | Mint | Pair (this hub) | Who it is for |
|----------------|------|-----------------|---------------|
| Local `~/.clanker/op.key` | Yes | Yes | CLI / terminal invitees |
| [Privy](https://docs.privy.io/) embedded EOA | Yes | Yes | [/join](/join) email login |
| [CDP](https://docs.cdp.coinbase.com/embedded-wallets/welcome) user wallet (EOA) | Yes | Yes | Adopters already on Coinbase Developer Platform |
| CDP API-key / [Turnkey](https://docs.turnkey.com/) | Yes | Yes if it can `personal_sign` | Backends / later CLI without a hex file |
| Injected EOA (MetaMask, Rabby) | Yes | Yes | People who already have a wallet |
| Base Account / ERC-1271 smart wallet | Maybe | **No** until the hub verifies ERC-1271 | Documented limit — do not use for full mesh Policy yet |

We do **not** endorse one vendor as identity. Pick the signer that fits your product; pin the same `(chainId, registryAddress)`.

## Two doors for humans

- **[/join](/join)** — email / passkey, mint in the browser, download the bot key. No terminal required for the name itself. You still need OpenClaw (separately) to run the agent.
- **CLI** — [Get started](/docs/get-started/) with `clanker setup` / `fund` / mint. You get `~/.clanker/op.key` on disk.

If you minted on `/join`, you do **not** have `op.key`. Use the site (or transfer later) for pair / transfer. `clanker whoami --address 0x…` still reads Facts.

## What this is not

- Not a friends list or a login database on chain
- Not permission to message anyone (Policy stays in products)
- Not a promise that every smart wallet works with this hub’s pairing today
