import { expect, test } from "bun:test";
import { topicForInbox } from "@clanker-chain/mqtt-node-client";
import {
  MAX_BOT_ID_LENGTH,
  MAX_MESSAGE_TEXT_BYTES,
  MAX_REPLY_TO_LENGTH,
  resolveGatewayConfigFromToolContext,
  resolveMqttToolsConfig,
  resolveToolAccountId,
  validateMessageFields,
  validateRecipientBotId,
} from "../src/mqtt-config.js";
import {
  clearIdentityCacheForTests,
  isLikelyMqttAuthError,
  sendSignedDm,
} from "../src/send-signed-dm.js";

const unconfiguredMqtt = {
  accountId: "default",
  configured: false,
  userEnabled: false,
  botId: "",
  operatorId: "",
  brokerUrl: "",
  chainRpcUrl: "",
  registryAddress: "",
  mqttAuthServiceUrl: "http://localhost:9090",
};

test("validateRecipientBotId rejects display names", () => {
  expect(() => validateRecipientBotId("tooter-bot")).toThrow(/canonical bot id/);
  expect(() => validateRecipientBotId("openclaw.tooter.prod-1")).not.toThrow();
});

test("validateRecipientBotId rejects MQTT/topic injection characters", () => {
  for (const bad of [
    "openclaw.evil/../../other",
    "bots/other/inbox",
    "openclaw.foo+bar",
    "openclaw.#.prod",
    "openclaw..prod-1",
    ".openclaw.prod-1",
    "openclaw.prod-1.",
    "OpenClaw.Prod-1",
    "",
  ]) {
    expect(() => validateRecipientBotId(bad)).toThrow();
  }
});

test("topicForInbox uses canonical bot id", () => {
  expect(topicForInbox("openclaw.tooter.prod-1")).toBe("bots/openclaw.tooter.prod-1/inbox");
});

test("resolveMqttToolsConfig reads flat channels.mqtt", () => {
  const cfg = {
    channels: {
      mqtt: {
        enabled: true,
        botId: "openclaw.france.prod-1",
        operatorId: "org.openclaw.pat",
        brokerUrl: "mqtt://127.0.0.1:1883",
        chainRpcUrl: "http://127.0.0.1:8545",
        registryAddress: "0x1234567890123456789012345678901234567890",
        mqttAuthServiceUrl: "http://127.0.0.1:9090",
      },
    },
  };

  const mqtt = resolveMqttToolsConfig(cfg);
  expect(mqtt.configured).toBe(true);
  expect(mqtt.userEnabled).toBe(true);
  expect(mqtt.botId).toBe("openclaw.france.prod-1");
  expect(mqtt.mqttAuthServiceUrl).toBe("http://127.0.0.1:9090");
});

test("resolveMqttToolsConfig reads accounts slice", () => {
  const cfg = {
    channels: {
      mqtt: {
        enabled: true,
        accounts: {
          france: {
            enabled: true,
            botId: "openclaw.france.prod-1",
            operatorId: "org.openclaw.pat",
            brokerUrl: "mqtt://broker:1883",
            chainRpcUrl: "http://127.0.0.1:8545",
            registryAddress: "0x1234567890123456789012345678901234567890",
          },
        },
      },
    },
  };

  const mqtt = resolveMqttToolsConfig(cfg, "france");
  expect(mqtt.configured).toBe(true);
  expect(mqtt.accountId).toBe("france");
});

test('resolveMqttToolsConfig "default" is unconfigured when only accounts.* exist', () => {
  const cfg = {
    channels: {
      mqtt: {
        enabled: true,
        accounts: {
          france: {
            enabled: true,
            botId: "openclaw.france.prod-1",
            operatorId: "org.openclaw.pat",
            brokerUrl: "mqtt://broker:1883",
            chainRpcUrl: "http://127.0.0.1:8545",
            registryAddress: "0x1234567890123456789012345678901234567890",
          },
        },
      },
    },
  };

  expect(resolveMqttToolsConfig(cfg, "default").configured).toBe(false);
  expect(resolveMqttToolsConfig(cfg, "france").configured).toBe(true);
});

test("resolveGatewayConfigFromToolContext reads api.config", () => {
  const gateway = {
    channels: {
      mqtt: {
        enabled: true,
        botId: "openclaw.france.prod-1",
        operatorId: "org.openclaw.pat",
        brokerUrl: "mqtt://127.0.0.1:1883",
        chainRpcUrl: "http://127.0.0.1:8545",
        registryAddress: "0x1234567890123456789012345678901234567890",
      },
    },
  };
  expect(resolveGatewayConfigFromToolContext({})).toEqual({});
  expect(resolveGatewayConfigFromToolContext({ api: { config: gateway } })).toEqual(gateway);
  expect(
    resolveMqttToolsConfig(resolveGatewayConfigFromToolContext({ api: { config: gateway } }))
      .configured,
  ).toBe(true);
});

test("resolveToolAccountId prefers toolContext.accountId", () => {
  expect(
    resolveToolAccountId({
      toolContext: { accountId: "france" },
    }),
  ).toBe("france");
  expect(resolveToolAccountId({})).toBe("default");
});

test("sendSignedDm rejects unconfigured account", async () => {
  clearIdentityCacheForTests();
  await expect(
    sendSignedDm(unconfiguredMqtt, { to: "openclaw.tooter.prod-1", text: "hi" }),
  ).rejects.toThrow(/not configured/);
});

test("isLikelyMqttAuthError distinguishes auth from broker outages", () => {
  expect(isLikelyMqttAuthError(new Error("Connection refused: Not authorized"))).toBe(true);
  expect(isLikelyMqttAuthError(new Error("SIWE nonce expired"))).toBe(true);
  expect(isLikelyMqttAuthError(new Error("ECONNREFUSED 127.0.0.1:1883"))).toBe(false);
  expect(isLikelyMqttAuthError(new Error("getaddrinfo ENOTFOUND broker"))).toBe(false);
});

test("sendSignedDm rejects oversized replyTo without going through index", async () => {
  clearIdentityCacheForTests();
  const longReply = "r".repeat(MAX_REPLY_TO_LENGTH + 1);
  await expect(
    sendSignedDm(
      {
        ...unconfiguredMqtt,
        configured: true,
        userEnabled: true,
        botId: "openclaw.france.prod-1",
        operatorId: "org.openclaw.pat",
        brokerUrl: "mqtt://broker:1883",
        chainRpcUrl: "http://127.0.0.1:8545",
            registryAddress: "0x1234567890123456789012345678901234567890",
      },
      { to: "openclaw.tooter.prod-1", text: "hi", replyTo: longReply },
    ),
  ).rejects.toThrow(/replyTo/);
});

test("sendSignedDm rejects oversized text without going through index", async () => {
  clearIdentityCacheForTests();
  const big = "x".repeat(MAX_MESSAGE_TEXT_BYTES + 1);
  await expect(
    sendSignedDm(
      {
        ...unconfiguredMqtt,
        configured: true,
        userEnabled: true,
        botId: "openclaw.france.prod-1",
        operatorId: "org.openclaw.pat",
        brokerUrl: "mqtt://broker:1883",
        chainRpcUrl: "http://127.0.0.1:8545",
            registryAddress: "0x1234567890123456789012345678901234567890",
      },
      { to: "openclaw.tooter.prod-1", text: big },
    ),
  ).rejects.toThrow(/maximum size/);
});

test("validateRecipientBotId enforces MAX_BOT_ID_LENGTH", () => {
  const within = "a." + "b".repeat(MAX_BOT_ID_LENGTH - 2);
  expect(within.length).toBe(MAX_BOT_ID_LENGTH);
  expect(() => validateRecipientBotId(within)).not.toThrow();
  const over = "a." + "b".repeat(MAX_BOT_ID_LENGTH - 1);
  expect(over.length).toBe(MAX_BOT_ID_LENGTH + 1);
  expect(() => validateRecipientBotId(over)).toThrow(/maximum length/);
});

test("validateMessageFields enforces text size", () => {
  const big = "x".repeat(MAX_MESSAGE_TEXT_BYTES + 1);
  expect(() => validateMessageFields(big)).toThrow(/maximum size/);
  expect(() => validateMessageFields("ok")).not.toThrow();
});

test("sendSignedDm rejects disabled account", async () => {
  clearIdentityCacheForTests();
  await expect(
    sendSignedDm(
      {
        ...unconfiguredMqtt,
        configured: true,
        userEnabled: false,
        botId: "openclaw.france.prod-1",
        operatorId: "org.openclaw.pat",
        brokerUrl: "mqtt://broker:1883",
        chainRpcUrl: "http://127.0.0.1:8545",
            registryAddress: "0x1234567890123456789012345678901234567890",
      },
      { to: "openclaw.tooter.prod-1", text: "hi" },
    ),
  ).rejects.toThrow(/disabled/);
});
