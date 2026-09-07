#!/usr/bin/env node
/**
 * Manual integration test: SIWE CONNECT + optional EIP-712 sign smoke test.
 *
 * Prerequisites: Anvil (or Sepolia RPC) + registry, mqtt-auth-service, Mosquitto.
 *
 *   CHAIN_RPC_URL=http://127.0.0.1:8545 REGISTRY_ADDRESS=0x… \
 *   BOT_ETH_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
 *     node mqtt-service/test-connect.mjs
 */

import { IdentityClient } from "../identity-node-client/dist/index.js";
import { MqttClient, topicForInbox, topicForAnnounce } from "../mqtt-node-client/dist/index.js";

const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const chainRpcUrl =
  process.env.CHAIN_RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || "http://127.0.0.1:8545";
const registryAddress = process.env.REGISTRY_ADDRESS;
const mqttAuthUrl = process.env.MQTT_AUTH_SERVICE_URL || "http://localhost:9090";

async function main() {
  if (!registryAddress?.startsWith("0x")) {
    throw new Error("REGISTRY_ADDRESS is required");
  }
  console.log("Testing MQTT connect with SIWE auth...");
  console.log("Broker:", brokerUrl);
  console.log("RPC:", chainRpcUrl);
  console.log("Registry:", registryAddress);
  console.log("MQTT auth:", mqttAuthUrl);

  const franceBotId = "openclaw.france.prod-1";
  const franceOperator = "org.openclaw.pat";
  const tooterBotId = "openclaw.tooter.prod-1";

  const identityFrance = new IdentityClient({
    botId: franceBotId,
    operatorId: franceOperator,
    chainRpcUrl,
    registryAddress,
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

  const { signature, signature_scheme } = await identityFrance.signMessage(envelope);
  console.log("Signed envelope scheme:", signature_scheme, "sig len:", signature.length);

  const mqtt = new MqttClient();
  await mqtt.connect({
    brokerUrl,
    clientId: franceBotId,
    getPassword: () => identityFrance.issueMqttConnectPassword(),
  });
  console.log("Connected OK");

  await mqtt.subscribe([topicForInbox(franceBotId), topicForAnnounce()]);
  await mqtt.disconnect();
  console.log("Done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
