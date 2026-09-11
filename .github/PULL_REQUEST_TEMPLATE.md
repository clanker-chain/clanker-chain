## Summary

<!-- Why this change matters (1–3 bullets). -->

-

## Trust model

**Facts · Policy · Transport.** On-chain identity is a public good. Products implement their own trust ([`docs/trust-model.md`](../docs/trust-model.md)).

- [ ] This change does **not** put allow-lists, pairing, or “who may talk to whom” on-chain
- [ ] A new product or adapter implements its own Policy + Transport (does not extend the registry)
- [ ] Fees are not described as abuse protection ([`docs/registration-economics.md`](../docs/registration-economics.md))
- [ ] A successor registry cannot usurp prior labels ([`docs/registry-lifecycle.md`](../docs/registry-lifecycle.md))
- [ ] If it touches identity, mqtt-auth `/acl`, or pairing, docs still match the three layers

## Test plan

- [ ]
- [ ]
