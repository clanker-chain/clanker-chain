/**
 * Message envelope shape per bot-comms.md (subset used by the client).
 */
export interface MqttMessageEnvelope {
  from?: string;
  from_id?: string;
  operator_id?: string;
  to?: string;
  to_id?: string;
  type: string;
  subtype?: string;
  channel?: string;
  timestamp?: string;
  message_id?: string;
  correlation_id?: string;
  body?: unknown;
  signature?: string;
  signature_scheme?: string;
  [key: string]: unknown;
}

export interface MqttConnectOptions {
  brokerUrl: string;
  clientId: string;
  /** Called to get the MQTT password (SIWE `<nonce>.<sigHex>` from IdentityClient). */
  getPassword: () => Promise<string>;
  /** Optional username; defaults to clientId. */
  username?: string;
  /**
   * MQTT clean session flag. Default false (persistent session).
   * Use true for ephemeral one-shot publishers.
   */
  clean?: boolean;
}

export interface MqttPublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

export interface ReceivedMessage {
  topic: string;
  payload: unknown;
  qos: number;
  timestamp: string;
}
