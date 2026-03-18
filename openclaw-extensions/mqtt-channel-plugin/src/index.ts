/**
 * MQTT Channel Plugin Entry Point
 * 
 * Exports the MqttChannelProvider for use by OpenClaw.
 * OpenClaw will instantiate this provider when the channel is enabled.
 */

export { MqttChannelProvider } from './MqttChannelProvider.js';
export type {
  MqttChannelConfig,
  InboundMessage,
  OutboundMessage,
  MqttMessage,
  MessageHandler,
} from './types.js';

// Default export for OpenClaw channel loading
import { MqttChannelProvider } from './MqttChannelProvider.js';
export default MqttChannelProvider;
