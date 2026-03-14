#!/usr/bin/env node
/**
 * Runner for the identity skill. Invoke from OpenClaw via exec.
 *
 * Usage:
 *   node run.mjs init <bot_id> <operator_id>
 *   node run.mjs verify <bot_id> <operator_id>
 *   node run.mjs get-bot <bot_id>
 *   node run.mjs sign '<envelope_json>'
 *   node run.mjs issue-mqtt-token [ttl_sec]
 *
 * Env: IDENTITY_SERVICE_URL, IDENTITY_ADMIN_TOKEN (optional).
 */

import { IdentityClient } from "identity-node-client";

const [,, cmd, ...args] = process.argv;

function usage() {
  console.error(`Usage:
  node run.mjs init <bot_id> <operator_id>
  node run.mjs verify <bot_id> <operator_id>
  node run.mjs get-bot <bot_id>
  node run.mjs sign '<envelope_json>'
  node run.mjs issue-mqtt-token [ttl_sec]
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
      const identityServiceUrl = process.env.IDENTITY_SERVICE_URL ?? "http://localhost:8080";

      const publicKey = await client.getPublicKeyBase64();
      await client.init();
      const bot = await client.getBot();
      const hasActiveKey =
        Array.isArray(bot.public_keys) &&
        bot.public_keys.some((k) => k.public_key === publicKey && k.status === "active");

      console.log(
        JSON.stringify({
          ok: true,
          bot_id: botId,
          operator_id: operatorId,
          identity_service_url: identityServiceUrl,
          public_key: publicKey,
          bot_has_active_key: hasActiveKey,
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

      const identityServiceUrl = process.env.IDENTITY_SERVICE_URL ?? "http://localhost:8080";
      const client = new IdentityClient({ botId, operatorId });

      const result = {
        ok: false,
        bot_id: botId,
        operator_id: operatorId,
        identity_service_url: identityServiceUrl,
        operator: { exists: false },
        bot: { exists: false },
        key: { matches: false, public_key: undefined },
        error: undefined,
      };

      try {
        const publicKey = await client.getPublicKeyBase64();
        result.key.public_key = publicKey;

        const opRes = await fetch(
          `${identityServiceUrl}/v1/operators/${encodeURIComponent(operatorId)}`,
        );
        if (!opRes.ok) {
          const text = await opRes.text();
          result.error =
            text || `operator lookup failed with status ${opRes.status}`;
          console.log(JSON.stringify(result));
          return;
        }
        result.operator.exists = true;

        const botRes = await fetch(
          `${identityServiceUrl}/v1/bots/${encodeURIComponent(botId)}`,
        );
        if (!botRes.ok) {
          const text = await botRes.text();
          result.error = text || `bot lookup failed with status ${botRes.status}`;
          console.log(JSON.stringify(result));
          return;
        }
        const bot = await botRes.json();
        result.bot.exists = true;

        const hasKey =
          Array.isArray(bot.public_keys) &&
          bot.public_keys.some(
            (k) => k.public_key === publicKey && k.status === "active",
          );
        result.key.matches = hasKey;

        if (!hasKey) {
          result.error =
            "bot exists but does not have an active public key matching the local key";
          console.log(JSON.stringify(result));
          return;
        }

        result.ok = true;
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
      const { signature, signature_scheme } = await client.signMessage(envelope);
      console.log(JSON.stringify({ signature, signature_scheme, envelope: { ...envelope, signature, signature_scheme } }));
      return;
    }

    if (cmd === "issue-mqtt-token") {
      const [botId, operatorId, ttlSecStr] = args;
      if (!botId || !operatorId) {
        console.error("identity issue-mqtt-token requires bot_id and operator_id");
        usage();
        process.exit(1);
      }
      const ttlSec = ttlSecStr ? parseInt(ttlSecStr, 10) : 300;
      if (Number.isNaN(ttlSec) || ttlSec < 1) {
        console.error("ttl_sec must be a positive number");
        process.exit(1);
      }
      const client = new IdentityClient({ botId, operatorId });
      const token = await client.issueMqttToken(ttlSec);
      console.log(token);
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
