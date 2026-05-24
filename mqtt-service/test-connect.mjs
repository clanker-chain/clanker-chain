#!/usr/bin/env node
/**
 * Manual integration test: SIWE CONNECT + optional EIP-712 sign smoke test.
 *
 * Prerequisites: Anvil + identity-service (EVM), mqtt-auth-service, Mosquitto.
 *
 *   BOT_ETH_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
 *     node mqtt-service/test-connect.mjs
 */

import { IdentityClient } from "../identity-node-client/dist/index.js";
import { MqttClient, topicForInbox, topicForAnnounce } from "../mqtt-node-client/dist/index.js";

const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const identityUrl = process.env.IDENTITY_SERVICE_URL || "http://localhost:8080";
const mqttAuthUrl = process.env.MQTT_AUTH_SERVICE_URL || "http://localhost:9090";

async function main() {
  console.log("Testing MQTT connect with SIWE auth...");
  console.log("Broker:", brokerUrl);
  console.log("Identity:", identityUrl);
  console.log("MQTT auth:", mqttAuthUrl);

  const franceBotId = "openclaw.france.prod-1";
  const franceOperator = "org.openclaw.pat";
  const tooterBotId = "openclaw.tooter.prod-1";

  const identityFrance = new IdentityClient({
    botId: franceBotId,
    operatorId: franceOperator,
    identityServiceUrl: identityUrl,
    mqttAuthServiceUrl: mqttAuthUrl,
    ethPrivateKey: process.env.BOT_ETH_PRIVATE_KEY,
  });

  await identityFrance.init();
  const bot = await identityFrance.getBot();
  const ethKey = identityFrance.getActiveEthPublicKey(bot);
  console.log("Ledger botKey:", ethKey);

  const envelope = {
    from: "france-bot",
    from_id: franceBotId,
    operator_id: franceOperator,
    to: "tooter-bot",
    to_id: tooterBotId,
    type: "coordination",
    timestamp: new Date().toISOString(),
    message_id: `test-${Date.now()}`,
    body: { action: "test-connect" },
  };
  const signed = await identityFrance.signMessage(envelope);
  console.log("EIP-712 signature_scheme:", signed.signature_scheme);

  const client = new MqttClient();
  await client.connect({
    brokerUrl,
    clientId: franceBotId,
    username: franceBotId,
    getPassword: () => identityFrance.issueMqttConnectPassword(),
  });
  console.log("France bot connected.");

  await client.subscribe([topicForAnnounce(), "bots/#"]);
  client.publishAnnounce({
    ...envelope,
    signature: signed.signature,
    signature_scheme: signed.signature_scheme,
  });
  console.log("Published signed message to bots/all/announce.");

  const tooterInbox = topicForInbox("tooter-bot");
  client.publishToInbox("tooter-bot", {
    ...envelope,
    signature: signed.signature,
    signature_scheme: signed.signature_scheme,
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
