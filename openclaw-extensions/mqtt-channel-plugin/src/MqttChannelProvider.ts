import { IdentityClient } from '@clanker-chain/identity-node-client';
import { MqttClient, type ReceivedMessage } from '@clanker-chain/mqtt-node-client';
import type {
  MqttChannelConfig,
  InboundMessage,
  OutboundMessage,
  MqttMessage,
  MessageHandler,
} from './types.js';

type MessagePayload = Record<string, unknown>;

function isRecord(value: unknown): value is MessagePayload {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function valueToText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function applyBotIdPlaceholders(topic: string, botId: string): string {
  return topic.replace(/\{botId\}/g, botId);
}

function toInboundMessage(msg: ReceivedMessage, inboxTopic: string): InboundMessage {
  const payload = isRecord(msg.payload) ? msg.payload : undefined;
  const from = readString(payload?.from) ?? readString(payload?.from_id) ?? msg.topic;
  const body = payload?.body ?? payload?.text ?? msg.payload;
  const messageId =
    readString(payload?.message_id) ??
    readString(payload?.correlation_id) ??
    readString(payload?.id) ??
    `${from}-${msg.timestamp}`;
  const timestamp = readString(payload?.timestamp) ?? msg.timestamp;

  return {
    id: messageId,
    from,
    text: valueToText(body),
    channel: 'mqtt',
    chatType: msg.topic === inboxTopic ? 'direct' : 'group',
    timestamp: new Date(timestamp),
    topic: msg.topic,
    raw: msg,
  };
}

/**
 * MQTT Channel Provider for OpenClaw
 * 
 * Provides automatic message routing between bots via MQTT pub/sub.
 * Messages published to the bot's inbox topic are automatically routed
 * to the OpenClaw session, and replies are published back to the sender.
 */
type NormalizedMqttConfig = MqttChannelConfig & {
  topics: { inbox: string; announce: string; status: string };
  pollIntervalMs: number;
};

export class MqttChannelProvider {
  private config: NormalizedMqttConfig;
  private identityClient: IdentityClient;
  private mqttClient: MqttClient;
  private messageHandler?: MessageHandler;
  private pollingActive = false;
  private pollingPromise?: Promise<void>;

  constructor(config: MqttChannelConfig) {
    if (!config.identityServiceUrl) {
      throw new Error('MqttChannelProvider requires identityServiceUrl for JWT auth');
    }

    // Set defaults
    this.config = {
      ...config,
      topics: {
        inbox: config.topics?.inbox || `bots/{botId}/inbox`,
        announce: config.topics?.announce || `bots/all/announce`,
        status: config.topics?.status || `bots/{botId}/status`,
      },
      // Preserve explicit 0 (non-blocking/fast polling); default only when nullish.
      pollIntervalMs: config.pollIntervalMs ?? 1000,
    };

    // Replace {botId} placeholders
    this.config.topics.inbox = applyBotIdPlaceholders(
      this.config.topics.inbox!,
      this.config.botId
    );
    this.config.topics.announce = applyBotIdPlaceholders(
      this.config.topics.announce!,
      this.config.botId
    );
    this.config.topics.status = applyBotIdPlaceholders(
      this.config.topics.status!,
      this.config.botId
    );

    this.identityClient = new IdentityClient({
      botId: config.botId,
      operatorId: config.operatorId,
      identityServiceUrl: config.identityServiceUrl,
    });

    this.mqttClient = new MqttClient();
  }

  private async connectAndSubscribe(): Promise<void> {
    if (this.mqttClient.connected) {
      try {
        await this.mqttClient.disconnect();
      } catch {
        // Ignore disconnect cleanup errors before reconnecting.
      }
    }

    console.log('[mqtt-channel] Connecting to broker:', this.config.brokerUrl);
    await this.mqttClient.connect({
      brokerUrl: this.config.brokerUrl,
      clientId: this.config.botId,
      getPassword: async () => this.identityClient.issueMqttToken(),
    });
    console.log('[mqtt-channel] JWT token issued');
    console.log('[mqtt-channel] Connected to MQTT broker');

    const topics = [this.config.topics.inbox!, this.config.topics.announce!];
    console.log('[mqtt-channel] Subscribing to topics:', topics);
    await this.mqttClient.subscribe(topics);
  }

  /**
   * Start the channel provider
   * - Authenticates with identity service
   * - Connects to MQTT broker
   * - Subscribes to inbox and announce topics
   * - Starts message polling loop
   */
  async start(): Promise<void> {
    console.log('[mqtt-channel] Starting MQTT channel provider');
    console.log('[mqtt-channel] Bot ID:', this.config.botId);
    console.log('[mqtt-channel] Operator ID:', this.config.operatorId);

    // Initialize identity client and get JWT token
    console.log('[mqtt-channel] Initializing identity client...');
    await this.identityClient.init();
    await this.connectAndSubscribe();

    // Start polling loop
    this.pollingActive = true;
    this.pollingPromise = this.pollMessages();
    console.log('[mqtt-channel] Started message polling');
  }

  /**
   * Stop the channel provider
   * - Stops message polling
   * - Disconnects from MQTT broker
   */
  async stop(): Promise<void> {
    console.log('[mqtt-channel] Stopping MQTT channel provider');
    
    this.pollingActive = false;
    if (this.pollingPromise) {
      await this.pollingPromise;
    }

    await this.mqttClient.disconnect();
    console.log('[mqtt-channel] Disconnected from MQTT broker');
  }

  /**
   * Register a message handler
   * Called when a message is received from MQTT
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  getInboxTopic(): string {
    return this.config.topics.inbox!;
  }

  getAnnounceTopic(): string {
    return this.config.topics.announce!;
  }

  /**
   * Publish a JSON payload to an arbitrary topic (e.g. announce / group replies).
   */
  async publishJson(topic: string, payload: Record<string, unknown>): Promise<void> {
    console.log('[mqtt-channel] Publishing JSON to:', topic);
    await this.mqttClient.publish(topic, payload);
  }

  /**
   * Send a message to another bot
   * Publishes to the recipient's inbox topic
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    const topic = `bots/${message.to}/inbox`;
    
    const mqttMessage: MqttMessage = {
      from: this.config.botId,
      to: message.to,
      timestamp: new Date().toISOString(),
      body: message.text,
      replyTo: message.replyTo,
    };

    console.log('[mqtt-channel] Publishing message to:', topic);
    await this.mqttClient.publish(topic, mqttMessage);
  }

  /**
   * Publish a status update
   * Used for heartbeats and presence
   */
  async publishStatus(status: Record<string, any>): Promise<void> {
    // Constructor sets a default topic, so this should never be undefined at runtime.
    const topic = this.config.topics.status!;
    
    const statusMessage = {
      botId: this.config.botId,
      timestamp: new Date().toISOString(),
      ...status,
    };

    console.log('[mqtt-channel] Publishing status to:', topic);
    await this.mqttClient.publish(topic, statusMessage);
  }

  /**
   * Internal message polling loop
   * Continuously polls for new messages and routes them to the handler
   */
  private async pollMessages(): Promise<void> {
    console.log('[mqtt-channel] Starting message polling loop');
    
    while (this.pollingActive) {
      try {
        if (!this.mqttClient.connected) {
          console.warn('[mqtt-channel] MQTT connection lost; reconnecting');
          await this.connectAndSubscribe();
        }

        const messages = await this.mqttClient.poll(this.config.pollIntervalMs);

        for (const msg of messages) {
          if (this.messageHandler) {
            try {
              const inboundMessage = toInboundMessage(msg, this.config.topics.inbox!);

              console.log('[mqtt-channel] Received message from:', inboundMessage.from);
              await this.messageHandler(inboundMessage);
            } catch (error) {
              console.error('[mqtt-channel] Error handling message:', error);
            }
          }
        }
      } catch (error) {
        if (this.pollingActive) {
          console.error('[mqtt-channel] Error polling messages:', error);
          try {
            await this.mqttClient.disconnect();
          } catch (disconnectError) {
            console.error('[mqtt-channel] Error disconnecting after poll failure:', disconnectError);
          }
          // Wait a bit before retrying
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    console.log('[mqtt-channel] Message polling loop stopped');
  }
}
