import mqtt from "mqtt";
import type {
  MqttConnectOptions,
  MqttPublishOptions,
  ReceivedMessage,
} from "./types.js";

export type { MqttConnectOptions, MqttMessageEnvelope, MqttPublishOptions, ReceivedMessage } from "./types.js";

/** Topic for a bot's inbox (direct messages to that bot). */
export function topicForInbox(botName: string): string {
  return `bots/${botName}/inbox`;
}

/** Topic for bot join/leave announcements. */
export function topicForAnnounce(): string {
  return "bots/all/announce";
}

/** Topic for private coordination between two bots (display names). */
export function topicForDmCoordination(bot1: string, bot2: string): string {
  const segment = [bot1, bot2].sort().join("-");
  return `dm/${segment}/coordination`;
}

/** Topic for a bot's status (heartbeat, retained). */
export function topicForStatus(botName: string): string {
  return `bots/${botName}/status`;
}

const defaultPublishOptions: MqttPublishOptions = { qos: 1, retain: false };

export class MqttClient {
  private client: mqtt.MqttClient | null = null;
  private received: ReceivedMessage[] = [];

  /**
   * Connect to the broker. Uses getPassword() for the CONNECT password (e.g. JWT from identity_issue_mqtt_token).
   */
  async connect(options: MqttConnectOptions): Promise<void> {
    if (this.client) {
      throw new Error("Already connected");
    }
    const password = await options.getPassword();
    const username = options.username ?? options.clientId;
    const clean = options.clean ?? false;
    return new Promise((resolve, reject) => {
      const c = mqtt.connect(options.brokerUrl, {
        clientId: options.clientId,
        username,
        password,
        clean,
        reconnectPeriod: 0,
      });
      c.on("message", (topic: string, payload: Buffer) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload.toString());
        } catch {
          parsed = payload.toString();
        }
        this.received.push({
          topic,
          payload: parsed,
          qos: 0,
          timestamp: new Date().toISOString(),
        });
      });
      c.once("connect", () => {
        this.client = c;
        this.received = [];
        resolve();
      });
      c.once("error", (err) => {
        this.client = null;
        reject(err);
      });
    });
  }

  /**
   * Publish a payload (object or string) to a topic.
   */
  publish(
    topic: string,
    payload: unknown,
    options: MqttPublishOptions = {}
  ): void {
    if (!this.client?.connected) {
      throw new Error("Not connected");
    }
    const opts = { ...defaultPublishOptions, ...options };
    const body =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    this.client.publish(topic, body, {
      qos: opts.qos ?? 1,
      retain: opts.retain ?? false,
    });
  }

  /**
   * Publish and wait for broker acknowledgment (QoS 1+). Surfaces ACL/size errors.
   */
  publishAck(
    topic: string,
    payload: unknown,
    options: MqttPublishOptions = {},
  ): Promise<void> {
    if (!this.client?.connected) {
      return Promise.reject(new Error("Not connected"));
    }
    const opts = { ...defaultPublishOptions, ...options };
    const qos = opts.qos ?? 1;
    const body =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      this.client!.publish(
        topic,
        body,
        { qos, retain: opts.retain ?? false },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  /**
   * Publish to a bot's inbox (convenience).
   */
  publishToInbox(toBotName: string, envelope: unknown): void {
    this.publish(topicForInbox(toBotName), envelope, { qos: 1 });
  }

  /**
   * Publish to bots/all/announce (convenience).
   */
  publishAnnounce(envelope: unknown): void {
    this.publish(topicForAnnounce(), envelope, { qos: 1 });
  }

  /**
   * Subscribe to one or more topics.
   */
  subscribe(topics: string[]): Promise<void> {
    if (!this.client?.connected) {
      return Promise.reject(new Error("Not connected"));
    }
    return new Promise((resolve, reject) => {
      this.client!.subscribe(topics, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Unsubscribe from one or more topics.
   */
  unsubscribe(topics: string[]): Promise<void> {
    if (!this.client?.connected) {
      return Promise.reject(new Error("Not connected"));
    }
    return new Promise((resolve, reject) => {
      this.client!.unsubscribe(topics, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Return messages received since last poll and clear the buffer.
   * Waits up to timeoutMs for at least one message if the buffer is empty.
   *
   * The wait listener must be removed on timeout. Leaving it registered (old
   * behavior) leaks listeners and can drain inbound messages in a stale handler
   * while the active poll returns empty — breaking long-lived channel consumers.
   */
  poll(timeoutMs: number = 100): Promise<ReceivedMessage[]> {
    if (!this.client?.connected) {
      return Promise.reject(new Error("Not connected"));
    }
    if (this.received.length > 0) {
      const out = this.received;
      this.received = [];
      return Promise.resolve(out);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (messages: ReceivedMessage[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.client!.removeListener("message", onMessage);
        resolve(messages);
      };
      const onMessage = () => {
        const out = this.received;
        this.received = [];
        finish(out);
      };
      const timer = setTimeout(() => finish([]), timeoutMs);
      this.client!.on("message", onMessage);
    });
  }

  /**
   * Disconnect from the broker.
   */
  async disconnect(): Promise<void> {
    if (!this.client) return;
    return new Promise((resolve) => {
      this.client!.end(false, {}, () => {
        this.client = null;
        this.received = [];
        resolve();
      });
    });
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }
}
