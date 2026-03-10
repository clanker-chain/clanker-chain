#!/usr/bin/env node
/**
 * Runner for the identity skill. Invoke from OpenClaw via exec.
 *
 * Usage:
 *   node run.mjs init <bot_id> <operator_id>
 *   node run.mjs get-bot <bot_id>
 *   node run.mjs sign '<envelope_json>'
 *
 * Env: IDENTITY_SERVICE_URL, IDENTITY_ADMIN_TOKEN (optional).
 */

import { IdentityClient } from "identity-node-client";

const [,, cmd, ...args] = process.argv;

function usage() {
  console.error(`Usage:
  node run.mjs init <bot_id> <operator_id>
  node run.mjs get-bot <bot_id>
  node run.mjs sign '<envelope_json>'
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
      console.log(JSON.stringify({ ok: true, bot_id: botId, operator_id: operatorId }));
      return;
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
      const { signature, signature_scheme } = await client.signMessage(envelope);
      console.log(JSON.stringify({ signature, signature_scheme, envelope: { ...envelope, signature, signature_scheme } }));
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
