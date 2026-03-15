import { IdentityClient } from 'identity-node-client';
import { MqttClient } from 'mqtt-node-client';
import type {
  MqttChannelConfig,
  InboundMessage,
  OutboundMessage,
  MqttMessage,
  MessageHandler,
} from './types.js';

/**
 * MQTT Channel Provider for OpenClaw
 * 
 * Provides automatic message routing between bots via MQTT pub/sub.
 * Messages published to the bot's inbox topic are automatically routed
 * to the OpenClaw session, and replies are published back to the sender.
 */
export class MqttChannelProvider {
  private config: Required<MqttChannelConfig>;
  private identityClient: IdentityClient;
  private mqttClient: MqttClient;
  private messageHandler?: MessageHandler;
  private pollingActive = false;
  private pollingPromise?: Promise<void>;

  constructor(config: MqttChannelConfig) {
    // Set defaults
    this.config = {
      ...config,
      topics: {
        inbox: config.topics?.inbox || `bots/{botId}/inbox`,
        announce: config.topics?.announce || `bots/all/announce`,
        status: config.topics?.status || `bots/{botId}/status`,
      },
      pollIntervalMs: config.pollIntervalMs || 1000,
    };

    // Replace {botId} placeholders
    this.config.topics.inbox = this.config.topics.inbox.replace(
      '{botId}',
      this.config.botId
    );
    this.config.topics.status = this.config.topics.status.replace(
      '{botId}',
      this.config.botId
    );

    this.identityClient = new IdentityClient({
      botId: config.botId,
      operatorId: config.operatorId,
      identityServiceUrl: config.identityServiceUrl,
    });

    this.mqttClient = new MqttClient();
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
    const token = await this.identityClient.issueMqttToken();
    console.log('[mqtt-channel] JWT token issued');

    // Connect to MQTT broker
    console.log('[mqtt-channel] Connecting to broker:', this.config.brokerUrl);
    await this.mqttClient.connect({
      brokerUrl: this.config.brokerUrl,
      clientId: this.config.botId,
      getPassword: async () => token,
    });
    console.log('[mqtt-channel] Connected to MQTT broker');

    // Subscribe to topics
    const topics = [this.config.topics.inbox, this.config.topics.announce];
    console.log('[mqtt-channel] Subscribing to topics:', topics);
    await this.mqttClient.subscribe(topics);

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
    const topic = this.config.topics.status;
    
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
        const messages = await this.mqttClient.poll(this.config.pollIntervalMs);

        for (const msg of messages) {
          if (this.messageHandler) {
            try {
              const inboundMessage: InboundMessage = {
                id: msg.id || `${msg.from}-${Date.now()}`,
                from: msg.from,
                text: msg.body,
                channel: 'mqtt',
                chatType: msg.topic.includes('/inbox') ? 'direct' : 'group',
                timestamp: new Date(msg.timestamp),
                topic: msg.topic,
                raw: msg,
              };

              console.log('[mqtt-channel] Received message from:', msg.from);
              await this.messageHandler(inboundMessage);
            } catch (error) {
              console.error('[mqtt-channel] Error handling message:', error);
            }
          }
        }
      } catch (error) {
        if (this.pollingActive) {
          console.error('[mqtt-channel] Error polling messages:', error);
          // Wait a bit before retrying
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    console.log('[mqtt-channel] Message polling loop stopped');
  }
}
