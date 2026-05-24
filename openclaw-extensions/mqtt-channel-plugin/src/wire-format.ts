import { CLANKER_MESSAGE_SIGNATURE_SCHEME } from "@clanker-chain/identity-node-client";
import type { IdentityMessageEnvelope } from "@clanker-chain/identity-node-client";

export type MessagePayload = Record<string, unknown>;

export function isRecord(value: unknown): value is MessagePayload {
  return typeof value === "object" && value !== null;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function valueToText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function bodyToText(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (isRecord(body) && "text" in body) {
    return valueToText(body.text);
  }
  return valueToText(body);
}

export function buildCoordinationEnvelope(input: {
  botId: string;
  operatorId: string;
  to: string;
  text: string;
  replyTo?: string;
  timestamp?: string;
  messageId?: string;
}): IdentityMessageEnvelope {
  const isCanonicalBotId = input.to.includes(".");
  return {
    from: input.botId,
    from_id: input.botId,
    operator_id: input.operatorId,
    to: input.to,
    to_id: isCanonicalBotId ? input.to : "",
    type: "coordination",
    timestamp: input.timestamp ?? new Date().toISOString(),
    message_id: input.messageId ?? crypto.randomUUID(),
    correlation_id: input.replyTo,
    body: { text: input.text },
  };
}

export function attachSignature(
  envelope: IdentityMessageEnvelope,
  signature: string,
  signatureScheme: string = CLANKER_MESSAGE_SIGNATURE_SCHEME,
): MessagePayload {
  return {
    ...envelope,
    signature,
    signature_scheme: signatureScheme,
  };
}

export function parseSignedEnvelope(
  payload: MessagePayload | undefined,
): { envelope: IdentityMessageEnvelope; signature: string } | null {
  if (!payload) return null;

  const fromId = readString(payload.from_id);
  const signature = readString(payload.signature);
  const signatureScheme = readString(payload.signature_scheme);
  const operatorId = readString(payload.operator_id);
  const messageId = readString(payload.message_id);
  const timestamp = readString(payload.timestamp);
  const type = readString(payload.type);

  if (
    !fromId ||
    !signature ||
    !operatorId ||
    !messageId ||
    !timestamp ||
    !type ||
    signatureScheme !== CLANKER_MESSAGE_SIGNATURE_SCHEME
  ) {
    return null;
  }

  return {
    envelope: {
      from: readString(payload.from) ?? fromId,
      from_id: fromId,
      operator_id: operatorId,
      to: readString(payload.to),
      to_id: readString(payload.to_id),
      type,
      subtype: readString(payload.subtype),
      channel: readString(payload.channel),
      timestamp,
      message_id: messageId,
      correlation_id: readString(payload.correlation_id),
      body: payload.body,
    },
    signature,
  };
}
