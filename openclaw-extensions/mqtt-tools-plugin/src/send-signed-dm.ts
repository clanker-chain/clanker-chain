import { IdentityClient } from "@clanker-chain/identity-node-client";
import { MqttClient, topicForInbox } from "@clanker-chain/mqtt-node-client";
import type { ResolvedMqttToolsConfig } from "./mqtt-config.js";
import { validateMessageFields, validateRecipientBotId } from "./mqtt-config.js";
import { attachSignature, buildCoordinationEnvelope } from "./wire-format.js";

export type SendSignedDmInput = {
  to: string;
  text: string;
  replyTo?: string;
};

export type SendSignedDmOptions = {
  signal?: AbortSignal;
};

export type SendSignedDmResult = {
  ok: true;
  to: string;
  topic: string;
  message_id: string;
};

function checkAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function phaseError(phase: "sign" | "connect" | "publish", err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`mqtt_send: ${phase} failed (${message})`);
}

/** True when a connect/password failure likely indicates stale SIWE credentials, not a down broker. */
export function isLikelyMqttAuthError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes("auth") ||
    message.includes("password") ||
    message.includes("siwe") ||
    message.includes("nonce") ||
    message.includes("unauthorized") ||
    message.includes("not authorized") ||
    message.includes("not authorised") ||
    message.includes("bad user name or password") ||
    message.includes("connack") ||
    /\bcode\s*5\b/.test(message)
  );
}

function identityCacheKey(mqtt: ResolvedMqttToolsConfig): string {
  return `${mqtt.accountId}:${mqtt.botId}`;
}

type IdentityCacheEntry = {
  client: IdentityClient;
  ready: Promise<void>;
};

const identityCache = new Map<string, IdentityCacheEntry>();

function invalidateIdentityCache(mqtt: ResolvedMqttToolsConfig): void {
  identityCache.delete(identityCacheKey(mqtt));
}

async function getReadyIdentity(
  mqtt: ResolvedMqttToolsConfig,
  signal?: AbortSignal,
): Promise<IdentityClient> {
  const key = identityCacheKey(mqtt);
  let entry = identityCache.get(key);
  if (!entry) {
    const client = new IdentityClient({
      botId: mqtt.botId,
      operatorId: mqtt.operatorId,
      identityServiceUrl: mqtt.identityServiceUrl,
      mqttAuthServiceUrl: mqtt.mqttAuthServiceUrl,
    });
    const ready = client.init().catch((err) => {
      identityCache.delete(key);
      throw err;
    });
    entry = { client, ready };
    identityCache.set(key, entry);
  }
  checkAborted(signal);
  await entry.ready;
  return entry.client;
}

/** Serialize ephemeral mqtt_send connects per bot to avoid duplicate clientId session fights. */
const sendChains = new Map<string, Promise<unknown>>();

function enqueueSend<T>(botId: string, run: () => Promise<T>): Promise<T> {
  const prev = sendChains.get(botId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(run);
  sendChains.set(
    botId,
    next.catch(() => undefined),
  );
  return next;
}

export async function sendSignedDm(
  mqtt: ResolvedMqttToolsConfig,
  input: SendSignedDmInput,
  options: SendSignedDmOptions = {},
): Promise<SendSignedDmResult> {
  return enqueueSend(mqtt.botId || "__unconfigured__", () =>
    sendSignedDmOnce(mqtt, input, options),
  );
}

async function sendSignedDmOnce(
  mqtt: ResolvedMqttToolsConfig,
  input: SendSignedDmInput,
  options: SendSignedDmOptions,
): Promise<SendSignedDmResult> {
  const { signal } = options;
  checkAborted(signal);

  if (!mqtt.configured) {
    throw new Error(
      `mqtt_send: channels.mqtt is not configured for account "${mqtt.accountId}" ` +
        "(need botId, operatorId, brokerUrl, identityServiceUrl). " +
        "Install @clanker-chain/mqtt-channel-plugin and set channels.mqtt or channels.mqtt.accounts.<id>.",
    );
  }
  if (!mqtt.userEnabled) {
    throw new Error(`mqtt_send: channels.mqtt account "${mqtt.accountId}" is disabled.`);
  }

  validateRecipientBotId(input.to);
  validateMessageFields(input.text, input.replyTo);

  let identity: IdentityClient;
  try {
    identity = await getReadyIdentity(mqtt, signal);
  } catch (err) {
    invalidateIdentityCache(mqtt);
    throw err;
  }

  checkAborted(signal);

  const envelope = buildCoordinationEnvelope({
    botId: mqtt.botId,
    operatorId: mqtt.operatorId,
    to: input.to,
    text: input.text,
    replyTo: input.replyTo,
  });

  let signature: string;
  let signature_scheme: string;
  try {
    const signed = await identity.signMessage(envelope);
    signature = signed.signature;
    signature_scheme = signed.signature_scheme;
  } catch (err) {
    invalidateIdentityCache(mqtt);
    throw phaseError("sign", err);
  }

  checkAborted(signal);
  const wirePayload = attachSignature(envelope, signature, signature_scheme);

  const topic = topicForInbox(input.to);
  const client = new MqttClient();
  const ephemeralClientId = `${mqtt.botId}-send-${envelope.message_id.replace(/-/g, "").slice(0, 12)}`;

  try {
    checkAborted(signal);
    try {
      await client.connect({
        brokerUrl: mqtt.brokerUrl,
        clientId: ephemeralClientId,
        username: mqtt.botId,
        clean: true,
        getPassword: async () => {
          try {
            return await identity.issueMqttConnectPassword();
          } catch (err) {
            invalidateIdentityCache(mqtt);
            throw err;
          }
        },
      });
    } catch (err) {
      if (isLikelyMqttAuthError(err)) {
        invalidateIdentityCache(mqtt);
      }
      throw phaseError("connect", err);
    }

    checkAborted(signal);
    try {
      await client.publishAck(topic, wirePayload, { qos: 1 });
    } catch (err) {
      throw phaseError("publish", err);
    }
  } finally {
    await client.disconnect();
  }

  return {
    ok: true,
    to: input.to,
    topic,
    message_id: envelope.message_id,
  };
}

/** Test helper: clear in-process identity init cache. */
export function clearIdentityCacheForTests(): void {
  identityCache.clear();
}
