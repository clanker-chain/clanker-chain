import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import { mqttChannelPlugin } from './channel.js';

const entry = defineChannelPluginEntry({
  id: 'mqtt-channel',
  name: 'MQTT Channel',
  description: 'MQTT channel for OpenClaw bot-to-bot messaging (Clanker Chain).',
  plugin: mqttChannelPlugin,
});

export default entry;
export { mqttChannelPlugin, entry };
export { MqttChannelProvider } from './MqttChannelProvider.js';
export type {
  MqttChannelConfig,
  InboundMessage,
  OutboundMessage,
  MqttMessage,
  MessageHandler,
} from './types.js';
