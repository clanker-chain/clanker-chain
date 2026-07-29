#!/usr/bin/env node
/**
 * Runner for the MQTT skill. Invoke from OpenClaw via exec.
 *
 * Usage:
 *   node run.mjs connect <bot_id> <operator_id>
 *   node run.mjs publish <bot_id> <operator_id> <topic> '<json>'
 *   node run.mjs subscribe <bot_id> <operator_id> <topic1> [topic2 ...]
 *   node run.mjs poll <bot_id> <operator_id> [timeout_ms] [topic1] [topic2 ...]
 *
 * Env: MQTT_BROKER_URL, MQTT_CLIENT_ID, CHAIN_RPC_URL, REGISTRY_ADDRESS.
 */

import { IdentityClient } from "@clanker-chain/identity-node-client";
import { MqttClient, topicForInbox, topicForAnnounce } from "@clanker-chain/mqtt-node-client";

const [,, cmd, ...args] = process.argv;

const brokerUrl = process.env.MQTT_BROKER_URL;
const clientId = process.env.MQTT_CLIENT_ID;
const displayName = process.env.MQTT_BOT_DISPLAY_NAME || clientId;

function usage() {
  console.error(`Usage:
  node run.mjs connect <bot_id> <operator_id>
  node run.mjs publish <bot_id> <operator_id> <topic> '<json>'
  node run.mjs subscribe <bot_id> <operator_id> <topic1> [topic2 ...]
  node run.mjs poll <bot_id> <operator_id> [timeout_ms] [topic1] [topic2 ...]
Env: MQTT_BROKER_URL, MQTT_CLIENT_ID
`);
}

async function createIdentity(botId, operatorId) {
  const identity = new IdentityClient({ botId, operatorId });
  await identity.init();
  return identity;
}

async function withConnection(botId, operatorId, fn) {
  if (!brokerUrl || !clientId) {
    throw new Error("MQTT_BROKER_URL and MQTT_CLIENT_ID are required");
  }
  const identity = await createIdentity(botId, operatorId);
  const mqtt = new MqttClient();
  await mqtt.connect({
    brokerUrl,
    clientId,
    username: botId,
    getPassword: () => identity.issueMqttConnectPassword(),
  });
  try {
    return await fn(mqtt);
  } finally {
    await mqtt.disconnect();
  }
}

async function main() {
  if (!cmd) {
    usage();
    process.exit(1);
  }

  try {
    if (cmd === "connect") {
      const [botId, operatorId] = args;
      if (!botId || !operatorId) {
        console.error("connect requires bot_id and operator_id");
        usage();
        process.exit(1);
      }
      await withConnection(botId, operatorId, async () => {});
      console.log(JSON.stringify({ ok: true }));
      return;
    }

    if (cmd === "publish") {
      const [botId, operatorId, topic, payloadJson] = args;
      if (!botId || !operatorId || !topic || payloadJson === undefined) {
        console.error("publish requires bot_id, operator_id, topic, and json payload");
        usage();
        process.exit(1);
      }
      let payload;
      try {
        payload = JSON.parse(payloadJson);
      } catch {
        payload = payloadJson;
      }
      await withConnection(botId, operatorId, (mqtt) => {
        mqtt.publish(topic, payload, { qos: 1 });
      });
      console.log(JSON.stringify({ ok: true }));
      return;
    }

    if (cmd === "subscribe") {
      const [botId, operatorId, ...topics] = args;
      if (!botId || !operatorId || topics.length === 0) {
        console.error("subscribe requires bot_id, operator_id, and at least one topic");
        usage();
        process.exit(1);
      }
      await withConnection(botId, operatorId, async (mqtt) => {
        await mqtt.subscribe(topics);
      });
      console.log(JSON.stringify({ ok: true }));
      return;
    }

    if (cmd === "poll") {
      const [botId, operatorId, timeoutOrTopic, ...rest] = args;
      if (!botId || !operatorId) {
        console.error("poll requires bot_id and operator_id");
        usage();
        process.exit(1);
      }
      let timeoutMs = 1000;
      let topics = [];
      const first = timeoutOrTopic;
      if (first !== undefined) {
        const n = parseInt(first, 10);
        if (!Number.isNaN(n) && n >= 0) {
          timeoutMs = n;
          topics = rest;
        } else {
          topics = [first, ...rest];
        }
      }
      if (topics.length === 0 && displayName) {
        topics = [topicForInbox(displayName), topicForAnnounce()];
      }
      const messages = await withConnection(botId, operatorId, async (mqtt) => {
        if (topics.length > 0) await mqtt.subscribe(topics);
        return mqtt.poll(timeoutMs);
      });
      console.log(JSON.stringify(messages));
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
