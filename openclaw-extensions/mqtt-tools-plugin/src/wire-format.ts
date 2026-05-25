import { CLANKER_MESSAGE_SIGNATURE_SCHEME } from "@clanker-chain/identity-node-client";
import type { IdentityMessageEnvelope } from "@clanker-chain/identity-node-client";
import { validateRecipientBotId } from "./mqtt-config.js";

export type MessagePayload = Record<string, unknown>;

export function buildCoordinationEnvelope(input: {
  botId: string;
  operatorId: string;
  to: string;
  text: string;
  replyTo?: string;
  timestamp?: string;
  messageId?: string;
}): IdentityMessageEnvelope {
  validateRecipientBotId(input.to);
  return {
    from: input.botId,
    from_id: input.botId,
    operator_id: input.operatorId,
    to: input.to,
    to_id: input.to,
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
