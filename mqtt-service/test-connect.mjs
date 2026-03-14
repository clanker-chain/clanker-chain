#!/usr/bin/env node
/**
 * Manual integration test: connect with crypto auth, publish, poll.
 * Prerequisites: identity service running, mqtt-auth-service running, Mosquitto running.
 *
 *   From repo root: node mqtt-service/test-connect.mjs
 *
 * Uses france-bot and tooter-bot (must be registered with keys in identity service).
 */

import { IdentityClient } from "../identity-node-client/dist/index.js";
import { MqttClient, topicForInbox, topicForAnnounce } from "../mqtt-node-client/dist/index.js";

const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const identityUrl = process.env.IDENTITY_SERVICE_URL || "http://localhost:8080";

async function main() {
  console.log("Testing MQTT connect with crypto auth...");
  console.log("Broker:", brokerUrl, "Identity:", identityUrl);

  const franceBotId = "openclaw.france.prod-1";
  const franceOperator = "org.openclaw.pat";
  const tooterBotId = "openclaw.tooter.prod-1";
  const tooterOperator = "org.openclaw.pat";

  const identityFrance = new IdentityClient({
    botId: franceBotId,
    operatorId: franceOperator,
    identityServiceUrl: identityUrl,
  });
  const tokenFrance = await identityFrance.issueMqttToken(300);
  console.log("France bot token obtained (length:", tokenFrance.length, ")");

  const client = new MqttClient();
  await client.connect({
    brokerUrl,
    clientId: franceBotId,
    username: franceBotId,
    getPassword: async () => tokenFrance,
  });
  console.log("France bot connected.");

  await client.subscribe([topicForAnnounce(), "bots/#"]);
  client.publishAnnounce({
    from: "france-bot",
    from_id: franceBotId,
    type: "coordination",
    body: { action: "test", ts: new Date().toISOString() },
  });
  console.log("Published to bots/all/announce.");

  const tooterInbox = topicForInbox("tooter-bot");
  client.publishToInbox("tooter-bot", {
    from: "france-bot",
    from_id: franceBotId,
    to: "tooter-bot",
    to_id: tooterBotId,
    type: "coordination",
    body: { action: "ping" },
  });
  console.log("Published to", tooterInbox);

  const messages = await client.poll(2000);
  console.log("Poll received", messages.length, "message(s):", JSON.stringify(messages, null, 2));

  await client.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
