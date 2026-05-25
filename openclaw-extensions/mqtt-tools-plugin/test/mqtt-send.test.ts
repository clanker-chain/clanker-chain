import { expect, test } from "bun:test";
import { topicForInbox } from "@clanker-chain/mqtt-node-client";
import { assertCanonicalBotId, resolveMqttToolsConfig } from "../src/mqtt-config.js";

test("assertCanonicalBotId rejects display names", () => {
  expect(() => assertCanonicalBotId("tooter-bot")).toThrow(/canonical bot id/);
  expect(() => assertCanonicalBotId("openclaw.tooter.prod-1")).not.toThrow();
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
        brokerUrl: "mqtt://192.168.1.197:1883",
        identityServiceUrl: "http://192.168.1.197:8080",
        mqttAuthServiceUrl: "http://192.168.1.197:9090",
      },
    },
  };

  const mqtt = resolveMqttToolsConfig(cfg);
  expect(mqtt.configured).toBe(true);
  expect(mqtt.userEnabled).toBe(true);
  expect(mqtt.botId).toBe("openclaw.france.prod-1");
  expect(mqtt.mqttAuthServiceUrl).toBe("http://192.168.1.197:9090");
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
            identityServiceUrl: "http://identity:8080",
          },
        },
      },
    },
  };

  const mqtt = resolveMqttToolsConfig(cfg, "france");
  expect(mqtt.configured).toBe(true);
  expect(mqtt.accountId).toBe("france");
});
