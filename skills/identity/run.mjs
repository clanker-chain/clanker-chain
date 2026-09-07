#!/usr/bin/env node
/**
 * Runner for the identity skill. Invoke from OpenClaw via exec.
 *
 * Usage:
 *   node run.mjs init <bot_id> <operator_id>
 *   node run.mjs verify <bot_id> <operator_id>
 *   node run.mjs get-bot <bot_id>
 *   node run.mjs sign '<envelope_json>'
 *   node run.mjs issue-mqtt-password
 *
 * Env: CHAIN_RPC_URL, REGISTRY_ADDRESS, MQTT_AUTH_SERVICE_URL, BOT_ETH_PRIVATE_KEY (optional).
 * Minting is on-chain via clanker-cli (not this skill).
 */

import { IdentityClient } from "@clanker-chain/identity-node-client";

const [,, cmd, ...args] = process.argv;

function chainEnv() {
  return {
    chain_rpc_url: process.env.CHAIN_RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? null,
    registry_address: process.env.REGISTRY_ADDRESS ?? null,
  };
}

function usage() {
  console.error(`Usage:
  node run.mjs init <bot_id> <operator_id>
  node run.mjs verify <bot_id> <operator_id>
  node run.mjs get-bot <bot_id>
  node run.mjs sign '<envelope_json>'
  node run.mjs issue-mqtt-password <bot_id> <operator_id>
Env: CHAIN_RPC_URL, REGISTRY_ADDRESS (required for IdentityClient)
`);
}

async function main() {
  if (!cmd) {
    usage();
    process.exit(1);
  }

  try {
    if (cmd === "init") {
      const [botId, operatorId] = args;
      if (!botId || !operatorId) {
        console.error("identity init requires bot_id and operator_id");
        usage();
        process.exit(1);
      }
      const client = new IdentityClient({ botId, operatorId });
      await client.init();
      const bot = await client.getBot();
      const onchainKey = bot.public_keys?.find(
        (k) => k.algorithm === "secp256k1-eth" && k.status === "active",
      )?.public_key;

      console.log(
        JSON.stringify({
          ok: true,
          bot_id: botId,
          operator_id: operatorId,
          ...chainEnv(),
          bot_key: onchainKey,
          bot,
        }),
      );
      return;
    }

    if (cmd === "verify") {
      const [botId, operatorId] = args;
      if (!botId || !operatorId) {
        console.error("identity verify requires bot_id and operator_id");
        usage();
        process.exit(1);
      }

      const client = new IdentityClient({ botId, operatorId });

      const result = {
        ok: false,
        bot_id: botId,
        operator_id: operatorId,
        ...chainEnv(),
        operator: { exists: false },
        bot: { exists: false },
        key: { matches: false, bot_key: undefined },
        error: undefined,
      };

      try {
        await client.init();
        result.ok = true;
        result.operator.exists = true;
        result.bot.exists = true;
        const bot = await client.getBot();
        result.key.bot_key = bot.public_keys?.find(
          (k) => k.algorithm === "secp256k1-eth" && k.status === "active",
        )?.public_key;
        result.key.matches = true;
        console.log(JSON.stringify(result));
        return;
      } catch (err) {
        result.error = (err && err.message) || String(err);
        console.log(JSON.stringify(result));
        return;
      }
    }

    if (cmd === "get-bot") {
      const [botId] = args;
      if (!botId) {
        console.error("identity get-bot requires bot_id");
        usage();
        process.exit(1);
      }
      const client = new IdentityClient({ botId, operatorId: "" });
      const bot = await client.getBot();
      console.log(JSON.stringify(bot));
      return;
    }

    if (cmd === "sign") {
      const [envelopeJson] = args;
      if (!envelopeJson) {
        console.error("identity sign requires envelope JSON string");
        usage();
        process.exit(1);
      }
      const envelope = JSON.parse(envelopeJson);
      const botId = envelope.from_id;
      const operatorId = envelope.operator_id;
      if (!botId || !operatorId) {
        console.error("envelope must include from_id and operator_id");
        process.exit(1);
      }
      const client = new IdentityClient({ botId, operatorId });
      await client.init();
      const { signature, signature_scheme } = await client.signMessage(envelope);
      console.log(JSON.stringify({ signature, signature_scheme, envelope: { ...envelope, signature, signature_scheme } }));
      return;
    }

    if (cmd === "issue-mqtt-password") {
      const [botId, operatorId] = args;
      if (!botId || !operatorId) {
        console.error("identity issue-mqtt-password requires bot_id and operator_id");
        usage();
        process.exit(1);
      }
      const client = new IdentityClient({ botId, operatorId });
      await client.init();
      const password = await client.issueMqttConnectPassword();
      console.log(password);
      return;
    }

    console.error("Unknown command:", cmd);
    usage();
    process.exit(1);
  } catch (err) {
    console.error(JSON.stringify({ error: (err && err.message) || String(err) }));
    process.exit(1);
  }
}

main();
