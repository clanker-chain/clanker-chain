/**
 * OpenClaw plugin entry. The main value is the MQTT skill in src/skill (see openclaw.plugin.json).
 */
export default {
  id: "mqtt-client",
  name: "MQTT client",
  description: "MQTT client and skill for clanker-chain bots (crypto auth).",
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  register() {},
};
