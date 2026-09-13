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

### Read vs sign (CLI)

| Kind | Commands | Needs |
|------|----------|--------|
| **Read / fund** | `whoami`, `bots`, `fund`, `doctor` | Owner **address** in the profile (or `--address`) |
| **Sign** | mint, pair, rotate, revoke, transfer | **`clanker login`** (email vault) **or** local `op.key` / `OPERATOR_PRIVATE_KEY` |

## Compatible signers (today)

| Implementation | Mint | Pair (this hub) | Who it is for |
|----------------|------|-----------------|---------------|
| `clanker login` (email vault) | Yes | Yes | Recommended CLI path — same wallet as [/join](/join) |
| Local `~/.clanker/op.key` | Yes | Yes | Self-custody / offline |
| Embedded EOA on [/join](/join) | Yes (browser) | Yes via `clanker login` | Email / passkey in the browser |
| [CDP](https://docs.cdp.coinbase.com/embedded-wallets/welcome) user wallet (EOA) | Yes | Yes | Adopters already on Coinbase Developer Platform |
| CDP API-key / [Turnkey](https://docs.turnkey.com/) | Yes | Yes if it can `personal_sign` | Backends / later CLI without a hex file |
| Injected EOA (MetaMask, Rabby) | Yes | Yes | People who already have a wallet |
| Base Account / ERC-1271 smart wallet | Maybe | **No** until the hub verifies ERC-1271 | Documented limit — do not use for full mesh Policy yet |

We do **not** endorse one vendor as identity. Pick the signer that fits your product; pin the same `(chainId, registryAddress)`.

## Two doors for humans

- **[/join](/join)** — email / passkey, mint in the browser, download the bot key. No terminal required for the name itself. You still need OpenClaw (separately) to run the agent.
- **CLI** — [Get started](/docs/get-started/) with `clanker login` (recommended) or a local key, then `fund` / mint / pair.

### After `/join`

Unlock the same operator wallet in the terminal (no `op.key` export):

```bash
clanker login
clanker setup --preset sepolia --operator org.you --yes --force
clanker fund
clanker whoami
clanker pair add org.openclaw.pat --yes
```

Approve on [/authorize](/authorize) with the same email. Lost the bot `.key` file? Mint another computer label under the same operator on `/join`.

Address-only attach (`--skip-key` without login) still works for `whoami` / `fund` / `doctor`, but cannot pair or mint until you `clanker login` or add a local key.

## What this is not

- Not a friends list or a login database on chain
- Not permission to message anyone (Policy stays in products)
- Not a promise that every smart wallet works with this hub’s pairing today
- Not Clanker custody — `login` is user-authorized vault access; we do not hold an app key that can move your name while you are offline
