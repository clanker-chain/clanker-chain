import { IdentityClient } from "@clanker-chain/identity-node-client";
import { MqttClient, topicForInbox } from "@clanker-chain/mqtt-node-client";
import type { ResolvedMqttToolsConfig } from "./mqtt-config.js";
import { attachSignature, buildCoordinationEnvelope } from "./wire-format.js";

export type SendSignedDmInput = {
  to: string;
  text: string;
  replyTo?: string;
};

export type SendSignedDmResult = {
  ok: true;
  to: string;
  topic: string;
  message_id: string;
};

export async function sendSignedDm(
  mqtt: ResolvedMqttToolsConfig,
  input: SendSignedDmInput,
): Promise<SendSignedDmResult> {
  if (!mqtt.configured) {
    throw new Error(
      "mqtt_send: channels.mqtt is not configured (need botId, operatorId, brokerUrl, identityServiceUrl). " +
        "Install @clanker-chain/mqtt-channel-plugin and set channels.mqtt in openclaw.json.",
    );
  }
  if (!mqtt.userEnabled) {
    throw new Error("mqtt_send: channels.mqtt is disabled (enabled: false).");
  }

  const identity = new IdentityClient({
    botId: mqtt.botId,
    operatorId: mqtt.operatorId,
    identityServiceUrl: mqtt.identityServiceUrl,
    mqttAuthServiceUrl: mqtt.mqttAuthServiceUrl,
  });
  await identity.init();

  const envelope = buildCoordinationEnvelope({
    botId: mqtt.botId,
    operatorId: mqtt.operatorId,
    to: input.to,
    text: input.text,
    replyTo: input.replyTo,
  });

  const { signature, signature_scheme } = await identity.signMessage(envelope);
  const wirePayload = attachSignature(envelope, signature, signature_scheme);

  const topic = topicForInbox(input.to);
  const client = new MqttClient();
  await client.connect({
    brokerUrl: mqtt.brokerUrl,
    clientId: mqtt.botId,
    username: mqtt.botId,
    getPassword: () => identity.issueMqttConnectPassword(),
  });
  try {
    client.publish(topic, wirePayload, { qos: 1 });
  } finally {
    await client.disconnect();
  }

  return {
    ok: true,
    to: input.to,
    topic,
    message_id: envelope.message_id,
  };
}
