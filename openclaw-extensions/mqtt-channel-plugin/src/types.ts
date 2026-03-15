/**
 * Type definitions for MQTT channel plugin
 */

export interface MqttChannelConfig {
  /** Bot ID (e.g., openclaw.tooter.prod-1) */
  botId: string;
  
  /** Operator ID (e.g., org.openclaw.pat) */
  operatorId: string;
  
  /** MQTT broker URL */
  brokerUrl: string;
  
  /** Identity service URL */
  identityServiceUrl: string;
  
  /** Topic configuration */
  topics?: {
    /** Inbox topic pattern (default: bots/{botId}/inbox) */
    inbox?: string;
    /** Announce topic pattern (default: bots/all/announce) */
    announce?: string;
    /** Status topic pattern (default: bots/{botId}/status) */
    status?: string;
  };
  
  /** Polling interval in milliseconds (default: 1000) */
  pollIntervalMs?: number;
}

export interface InboundMessage {
  /** Message ID */
  id: string;
  
  /** Sender bot ID */
  from: string;
  
  /** Message text */
  text: string;
  
  /** Channel type */
  channel: 'mqtt';
  
  /** Chat type (direct or group) */
  chatType: 'direct' | 'group';
  
  /** Message timestamp */
  timestamp: Date;
  
  /** Original MQTT topic */
  topic: string;
  
  /** Raw message payload */
  raw?: any;
}

export interface OutboundMessage {
  /** Recipient bot ID */
  to: string;
  
  /** Message text */
  text: string;
  
  /** Optional message ID for threading */
  replyTo?: string;
}

export interface MqttMessage {
  /** Sender bot ID */
  from: string;
  
  /** Recipient bot ID */
  to: string;
  
  /** ISO 8601 timestamp */
  timestamp: string;
  
  /** Message body */
  body: string;
  
  /** Optional message ID for threading */
  replyTo?: string;
  
  /** Optional signature for verification */
  signature?: string;
}

export type MessageHandler = (message: InboundMessage) => void | Promise<void>;
