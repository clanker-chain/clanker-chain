import type { Address, Hex, PrivateKeyAccount, TypedDataDomain } from "viem";
import { verifyTypedData } from "viem";
import type { IdentityMessageEnvelope } from "./types.js";

export const CLANKER_EIP712_DOMAIN_NAME = "ClankerChain";
export const CLANKER_EIP712_DOMAIN_VERSION = "1";
export const CLANKER_MESSAGE_SIGNATURE_SCHEME = "eip712-secp256k1" as const;

export interface ClankerEip712Domain {
  chainId: number;
  registryAddress: Address;
}

const messageTypes = {
  Message: [
    { name: "from", type: "string" },
    { name: "from_id", type: "string" },
    { name: "operator_id", type: "string" },
    { name: "to", type: "string" },
    { name: "to_id", type: "string" },
    { name: "type", type: "string" },
    { name: "subtype", type: "string" },
    { name: "timestamp", type: "string" },
    { name: "message_id", type: "string" },
    { name: "correlation_id", type: "string" },
    { name: "body", type: "string" },
  ],
} as const;

function strField(value: string | undefined | null): string {
  return value ?? "";
}

/** Canonical JSON: sorted object keys, stable across implementations. */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  return stringifyCanonical(value);
}

function stringifyCanonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyCanonical(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifyCanonical(obj[k])}`).join(",")}}`;
}

function bodyField(body: unknown): string {
  return canonicalJson(body);
}

export function buildEip712Domain(domain: ClankerEip712Domain): TypedDataDomain {
  return {
    name: CLANKER_EIP712_DOMAIN_NAME,
    version: CLANKER_EIP712_DOMAIN_VERSION,
    chainId: domain.chainId,
    verifyingContract: domain.registryAddress,
  };
}

export function envelopeToMessageValue(msg: IdentityMessageEnvelope) {
  return {
    from: strField(msg.from),
    from_id: strField(msg.from_id),
    operator_id: strField(msg.operator_id),
    to: strField(msg.to),
    to_id: strField(msg.to_id),
    type: strField(msg.type),
    subtype: strField(msg.subtype),
    timestamp: strField(msg.timestamp),
    message_id: strField(msg.message_id),
    correlation_id: strField(msg.correlation_id),
    body: bodyField(msg.body),
  };
}

export async function signEnvelope(
  account: PrivateKeyAccount,
  envelope: IdentityMessageEnvelope,
  domain: ClankerEip712Domain,
): Promise<{ signature: Hex; signature_scheme: typeof CLANKER_MESSAGE_SIGNATURE_SCHEME }> {
  const signature = await account.signTypedData({
    domain: buildEip712Domain(domain),
    types: messageTypes,
    primaryType: "Message",
    message: envelopeToMessageValue(envelope),
  });
  return { signature, signature_scheme: CLANKER_MESSAGE_SIGNATURE_SCHEME };
}

export async function verifyEnvelope(
  envelope: IdentityMessageEnvelope,
  signature: Hex,
  expectedBotKey: Address,
  domain: ClankerEip712Domain,
): Promise<boolean> {
  return verifyTypedData({
    address: expectedBotKey,
    domain: buildEip712Domain(domain),
    types: messageTypes,
    primaryType: "Message",
    message: envelopeToMessageValue(envelope),
    signature,
  });
}

export { messageTypes as clankerMessageTypes };
