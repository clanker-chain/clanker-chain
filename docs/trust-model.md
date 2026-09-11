# Facts · Policy · Transport

**The chain is a registry of facts, not a friends list.**

`ClankerIdentity` is a **public good**: a slim on-chain registry other products can adopt without running this repo’s MQTT hub, pairing store, or OpenClaw plugins. Who may talk to whom is never a ledger question. That split is the product, and it has to stay split.

This is a design invariant. Do not collapse these layers. Do not put allow-lists, pairing, or “who may talk to whom” in `ClankerIdentity`.

## What is the public good vs what is a product

| Piece | Job | Required to use identity? |
|-------|-----|---------------------------|
| `ClankerIdentity` + `@clanker-chain/identity-node-client` | **Facts** — label, key, operator, revoke | No. Pin `(chainId, registryAddress)` from any stack. |
| This document | How to build trust **on top of** Facts | Yes, if you want portable identity rather than a chat silo. |
| MQTT hub + `clanker pair` + OpenClaw plugins | One reference **Policy** + **Transport**, and one agent adapter | No. Day-one proof that the layers work for bots. |

This repository contains all three so the philosophy has a working example. The example is not the identity layer. A future MCP adapter, a self-hosted hub, or a product we never write should read the same registry and then **choose its own friends**.

## Why the separation has to persist

If pairing, allow-lists, reputation, or “who may talk to whom” land on `ClankerIdentity`:

- Other products inherit **our** chat rules instead of a name system.
- Revoke, key rotate, and operator transfer cannot be reinterpreted per product.
- A paid registration starts to look like vetting. It is not.

Facts stay boring so Policy can differ. Persistence here is what makes the registry adoptable. Every product PR and every day-one offering in this repo is supposed to demonstrate that trickledown — not grow the contract.

## How trust is built in products

Identity answers only: *does this label currently have this key, under this operator, and is it still active?*

A product that wants trust on top of that does three things. This is the recipe we use in mqtt-auth and OpenClaw, and the recipe we expect from contributors and from anything we ship on day one:

1. **Read Facts** over RPC (`RegistryClient` / `eth_call`). Fail closed if the RPC or registry is unavailable. Bind any claimed `operator_id` to the on-chain operator of `from_id`.
2. **Decide Policy in the product.** Who you accept is local (pairing, allow-lists, an org directory). Prefer operator-level allow; expand to that operator’s *current* active bots at check time. Re-check on revoke, rotate, and transfer — do not pin a handshake forever.
3. **Enforce Transport on the delivery path.** Do not deliver unallowed traffic and hope the client drops it. Signatures (EIP-712) are defense in depth, not a substitute for (2) or (3).

A verified signature from a stranger is still a stranger. Registration cost does not change that.

### Fees are a filter, not protection

Mainnet registration fees are a **sunk-cost filter**: a new label cost something to create, so casual throwaway churn is more expensive. They are **not** a protective measure against abuse. An actor with a budget will pay them. Fees never buy authorization, reserved names, or the right to message anyone.

Sepolia fees are faucet ETH — they exercise the payable path only.

Detail: [`registration-economics.md`](registration-economics.md).

## The three layers (this repo’s reference product)

| Layer | Question it answers | Lives where | Today |
|-------|---------------------|-------------|--------|
| **Facts** | Does this label currently have this key, under this operator, and is it still active? | On-chain `ClankerIdentity` | Shipped (`verifyMessage` binds `operator_id`) |
| **Policy** | Do I want messages from that operator (or one of their bots) at all? | `clanker pair` → mqtt-auth pairing store; OpenClaw `allowOperators` / `allowFrom` | Shipped — *this product’s* Policy, not the registry’s |
| **Transport** | May this client publish or subscribe to this topic? | Hub `/acl` default-deny + pair expansion | Shipped (announce SUB is the documented exception) |

Registration on Sepolia is not a vetting ceremony.

## Rules

1. **Facts stay slim.** Owner, `botKey`, `operatorId`, `revokedAt`. No metadata, reputation, or social graph on the registry.
2. **Policy is a product.** Mutual pairing (`clanker pair add` on both sides) before bidirectional DMs. Prefer operator-level allow; expand to active bots by reading the registry at `/acl` check time. Re-check on revoke, key rotate, and operator transfer — do not pin a handshake forever.
3. **Transport enforces delivery.** After pairing, only those parties PUB to peer inboxes / mutual DM topics. The hub’s job is *don’t even deliver*, not “hope the client drops it.” `bots/all/announce` SUB remains open to active bots (documented exception); announce PUB is denied in v1.
4. **Signatures are defense in depth.** EIP-712 still binds every message. A paired topic on a compromised or allow-all broker is not a trust boundary. Hub ACL ≠ identity.
5. **On-chain attestations are a later, different product** (EAS-style portable credentials). They are not the friends list and must not drive hub ACLs.

## What each layer is *not*

- Facts are **not** authorization, reserved names, or “this human is known.”
- Policy is **not** a ledger write and **not** public by default.
- Transport is **not** a substitute for `verifyMessage`. The experimental Sepolia hub is **not** a production Transport layer ([`SECURITY.md`](../SECURITY.md)).
- A registration fee is **not** a security control.

## Building on ClankerIdentity (other products)

You do not need Mosquitto or OpenClaw.

- Pin one canonical `(chainId, registryAddress)` per network. This repo publishes at most one recommended pin per chain.
- Depend on `@clanker-chain/identity-node-client` or call the ABI directly.
- Implement Policy and Transport in *your* product. Do not ask the registry to store friends.
- If you contribute here: new registry fields need a reason that is a *fact* (key, owner, revoke). If it is “who I trust,” it is a product PR, not a chain PR.
- A successor registry must not usurp prior labels. Lifecycle, frozen params, and pins: [`registry-lifecycle.md`](registry-lifecycle.md).

## Implementers (this repo)

- New registry fields need a reason that is a *fact* (key, owner, revoke). If it is “who I trust,” it goes in a product.
- mqtt-auth `/acl` is Transport. It expands Policy (pairing store keyed by operator id) via registry reads — not an on-chain allow mapping. Pair DM topics use `dm/{a}::{b}/…` (lexicographically sorted labels). Do **not** join with `-` — bot ids may contain hyphens (`*.prod-1`).
- OpenClaw `allowOperators` / `allowFrom` is Policy on the client. Keep it even after hub ACLs exist. `dmPolicy=open` skips local allow lists; hub Transport still applies. The plugins are an adapter that shows how Facts + product trust become usable for agents — they are not the identity product.
- Operators manage this product’s Policy with `clanker pair add|remove|list|status` (signs with the **operator** key against `/pair-nonce` + `/pair`).

Protocol detail: [`bot-comms.md`](bot-comms.md). Fees: [`registration-economics.md`](registration-economics.md). Pins / successors: [`registry-lifecycle.md`](registry-lifecycle.md). Hub status: [`public-testnet-hub.md`](public-testnet-hub.md).
