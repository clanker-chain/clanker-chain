import { expect, test } from "bun:test";
import { MqttChannelProvider } from "../src/MqttChannelProvider.js";
import type { MqttPublishOptions } from "@clanker-chain/mqtt-node-client";

const baseConfig = {
  botId: "openclaw.france.prod-1",
  operatorId: "org.openclaw.pat",
  brokerUrl: "mqtt://localhost:1883",
  identityServiceUrl: "http://localhost:8080",
  mqttAuthServiceUrl: "http://localhost:9090",
};

type PublishAckCall = {
  topic: string;
  payload: unknown;
  options?: MqttPublishOptions;
};

type ProviderTestHooks = {
  mqttClient: {
    publishAck: (
      topic: string,
      payload: unknown,
      options?: MqttPublishOptions,
    ) => Promise<void>;
  };
  identityClient: {
    signMessage: (envelope: unknown) => Promise<{
      signature: string;
      signature_scheme: string;
    }>;
  };
};

function installPublishAckSpy(
  provider: MqttChannelProvider,
  behavior?: (call: PublishAckCall) => Promise<void>,
): { calls: PublishAckCall[] } {
  const calls: PublishAckCall[] = [];
  const hooks = provider as unknown as ProviderTestHooks;
  hooks.mqttClient = {
    publishAck: async (topic, payload, options) => {
      const call = { topic, payload, options };
      calls.push(call);
      if (behavior) {
        await behavior(call);
      }
    },
  };
  hooks.identityClient = {
    signMessage: async () => ({
      signature: "0x" + "ab".repeat(65),
      signature_scheme: "eip712-secp256k1",
    }),
  };
  return { calls };
}

test("publishStatus uses QoS 1 with retain for last-known presence", async () => {
  const provider = new MqttChannelProvider(baseConfig);
  const { calls } = installPublishAckSpy(provider);

  await provider.publishStatus({ status: "online" });

  expect(calls.length).toBe(1);
  expect(calls[0]?.topic).toBe("bots/openclaw.france.prod-1/status");
  expect(calls[0]?.options).toEqual({ qos: 1, retain: true });
});

test("publishJson awaits publishAck and surfaces broker errors", async () => {
  const provider = new MqttChannelProvider(baseConfig);
  installPublishAckSpy(provider, async () => {
    throw new Error("ACL denied");
  });

  await expect(provider.publishJson("bots/all/announce", { hello: 1 })).rejects.toThrow(
    "ACL denied",
  );
});

test("sendMessage awaits publishAck and surfaces broker errors", async () => {
  const provider = new MqttChannelProvider(baseConfig);
  installPublishAckSpy(provider, async () => {
    throw new Error("not authorized");
  });

  await expect(
    provider.sendMessage({
      to: "openclaw.tooter.prod-1",
      text: "coord-smoke-007",
    }),
  ).rejects.toThrow("not authorized");
});

test("sendMessage publishes signed payload to recipient inbox via publishAck", async () => {
  const provider = new MqttChannelProvider(baseConfig);
  const { calls } = installPublishAckSpy(provider);

  await provider.sendMessage({
    to: "openclaw.tooter.prod-1",
    text: "hello",
  });

  expect(calls.length).toBe(1);
  expect(calls[0]?.topic).toBe("bots/openclaw.tooter.prod-1/inbox");
  expect(calls[0]?.options).toEqual({ qos: 1 });
  const wire = calls[0]?.payload as Record<string, unknown>;
  expect(wire.signature_scheme).toBe("eip712-secp256k1");
  expect(wire.body).toEqual({ text: "hello" });
});
