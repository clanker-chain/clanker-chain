#!/usr/bin/env node
/**
 * DEPRECATED skill runner for @clanker-chain/identity-plugin.
 * Use skills/identity + @clanker-chain/identity-node-client instead.
 */

console.error(
  JSON.stringify({
    error:
      "@clanker-chain/identity-plugin is deprecated. Use @clanker-chain/identity-node-client with CHAIN_RPC_URL + REGISTRY_ADDRESS (see skills/identity and identity-client-plugin/DEPRECATED.md).",
  }),
);
process.exit(1);
