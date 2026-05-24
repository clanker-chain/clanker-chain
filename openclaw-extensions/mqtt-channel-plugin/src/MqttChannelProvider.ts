import { IdentityClient } from '@clanker-chain/identity-node-client';
import { MqttClient, type ReceivedMessage } from '@clanker-chain/mqtt-node-client';
import {
  attachSignature,
  bodyToText,
  buildCoordinationEnvelope,
  isRecord,
  parseSignedEnvelope,
  readString,
} from './wire-format.js';
import type {
  MqttChannelConfig,
  InboundMessage,
  OutboundMessage,
  MessageHandler,
} from './types.js';

function applyBotIdPlaceholders(topic: string, botId: string): string {
  return topic.replace(/\{botId\}/g, botId);
}

function toInboundMessage(msg: ReceivedMessage, inboxTopic: string): InboundMessage {
  const payload = isRecord(msg.payload) ? msg.payload : undefined;
  const from = readString(payload?.from_id) ?? readString(payload?.from) ?? msg.topic;
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
    text: bodyToText(body),
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
      throw new Error('MqttChannelProvider requires identityServiceUrl');
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
      mqttAuthServiceUrl: config.mqttAuthServiceUrl,
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
      getPassword: () => this.identityClient.issueMqttConnectPassword(),
    });
    console.log('[mqtt-channel] MQTT CONNECT password issued');
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

    // Initialize identity client (SIWE CONNECT + EIP-712 signing)
    console.log('[mqtt-channel] Initializing identity client...');
    await this.identityClient.init();
    await this.connectAndSubscribe();

    // Start polling loop
    this.pollingActive = true;
    this.pollingPromise = this.pollMessages();
    console.log('[mqtt-channel] Started message polling');
  }

  /**
   * Start the channel and keep this promise pending until `signal` aborts.
   * Does not call {@link stop} on abort; teardown is the caller's responsibility
   * (the gateway plugin uses `stopAccount` as the single teardown point).
   */
  async runUntilAborted(signal: AbortSignal): Promise<void> {
    await this.start();
    if (signal.aborted) {
      return;
    }
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
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
   * Does not sign — inbound peers using strict verification will drop unsigned payloads.
   * Prefer {@link sendMessage} for coordination traffic.
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
    const envelope = buildCoordinationEnvelope({
      botId: this.config.botId,
      operatorId: this.config.operatorId,
      to: message.to,
      text: message.text,
      replyTo: message.replyTo,
    });

    const { signature, signature_scheme } = await this.identityClient.signMessage(envelope);
    const wirePayload = attachSignature(envelope, signature, signature_scheme);

    console.log('[mqtt-channel] Publishing signed message to:', topic);
    await this.mqttClient.publish(topic, wirePayload);
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
          if (!this.messageHandler) continue;

          try {
            const payload = isRecord(msg.payload) ? msg.payload : undefined;
            const signed = parseSignedEnvelope(payload);
            if (!signed) {
              console.warn(
                "[mqtt-channel] Dropping unsigned or malformed MQTT message on",
                msg.topic,
              );
              continue;
            }

            const verified = await this.identityClient.verifyMessage(
              signed.envelope,
              signed.signature as `0x${string}`,
              signed.envelope.from_id,
            );
            if (!verified) {
              console.warn(
                "[mqtt-channel] Invalid EIP-712 signature from",
                signed.envelope.from_id,
                "on",
                msg.topic,
              );
              continue;
            }

            const inboundMessage = toInboundMessage(msg, this.config.topics.inbox!);

            console.log('[mqtt-channel] Received verified message from:', inboundMessage.from);
            await this.messageHandler(inboundMessage);
          } catch (error) {
            console.error('[mqtt-channel] Error handling message:', error);
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
