import type { BotRecord, OperatorRecord, PublicKeyRecord } from "./ledger";

const OPERATOR_ID_REGEX = /^[a-z0-9_.-]+$/;
// namespace.role.instance
const BOT_ID_REGEX = /^[a-z0-9_.-]+\.[a-z0-9_.-]+\.[a-z0-9_.-]+$/;

/** Timestamp window for replay protection (e.g. 5 minutes). */
export const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

export interface MintOperatorBody {
  operator_id: string;
  display_name?: string;
  public_key: string;
  signature: string;
  message: string;
}

export interface MintBotBody {
  bot_id: string;
  operator_id: string;
  display_name?: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  bot_public_key: string;
  operator_signature: string;
  message: string;
}

export interface AddKeySignedBody {
  public_key: string;
  operator_signature: string;
  message: string;
}

/** Legacy / unused; kept for reference. */
export interface CreateOperatorBody {
  operator_id: string;
  display_name?: string;
  public_keys?: PublicKeyRecord[];
}

export interface CreateBotBody {
  bot_id: string;
  display_name?: string;
  operator_id: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
}

export interface AddKeyBody {
  key_id?: string;
  algorithm: string;
  public_key: string;
  metadata?: Record<string, unknown>;
}

export function validateOperatorId(id: string): void {
  if (!id || !OPERATOR_ID_REGEX.test(id)) {
    throw new Error("invalid operator_id");
  }
}

export function validateBotId(id: string): void {
  if (!id || !BOT_ID_REGEX.test(id)) {
    throw new Error("invalid bot_id");
  }
}

export function isTimestampRecent(isoString: string): boolean {
  const t = Date.parse(isoString);
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  return Math.abs(now - t) <= TIMESTAMP_WINDOW_MS;
}

function validatePublicKeyBase64(s: string): void {
  try {
    const decoded = Buffer.from(s, "base64");
    if (decoded.length !== 32) throw new Error("must decode to 32 bytes");
  } catch {
    throw new Error("public_key must be valid base64 (32 bytes)");
  }
}

function validateSignatureBase64(s: string): void {
  try {
    const decoded = Buffer.from(s, "base64");
    if (decoded.length !== 64) throw new Error("must decode to 64 bytes");
  } catch {
    throw new Error("signature must be valid base64 (64 bytes)");
  }
}

/** Parse timestamp from canonical message (last segment after colons; timestamp may contain colons). */
export function parseTimestampFromMessage(message: string, expectedPrefix: string): string | null {
  if (!message.startsWith(expectedPrefix + ":")) return null;
  const rest = message.slice(expectedPrefix.length + 1);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon === -1) return null;
  return rest.slice(lastColon + 1);
}

export function validateMintOperator(body: unknown): MintOperatorBody {
  if (typeof body !== "object" || body === null) throw new Error("body must be an object");
  const { operator_id, display_name, public_key, signature, message } = body as MintOperatorBody;
  if (typeof operator_id !== "string") throw new Error("operator_id is required");
  if (typeof public_key !== "string") throw new Error("public_key is required");
  if (typeof signature !== "string") throw new Error("signature is required");
  if (typeof message !== "string") throw new Error("message is required");
  validateOperatorId(operator_id);
  validatePublicKeyBase64(public_key);
  validateSignatureBase64(signature);
  if (display_name !== undefined && typeof display_name !== "string") throw new Error("display_name must be a string");
  const expected = `mint-operator:${operator_id}:${public_key}:`;
  if (!message.startsWith(expected)) throw new Error("message does not match canonical format mint-operator:operator_id:public_key:timestamp");
  const timestamp = message.slice(expected.length);
  if (!timestamp || !isTimestampRecent(timestamp)) throw new Error("timestamp missing or not recent");
  return { operator_id, display_name, public_key, signature, message };
}

export interface ValidateMintBotOptions {
  /** If true, only require a timestamp in the message; do not enforce recency (one-time / bootstrap use). */
  skipTimestampRecency?: boolean;
}

export function validateMintBot(
  body: unknown,
  operators: Record<string, OperatorRecord>,
  bots: Record<string, BotRecord>,
  options?: ValidateMintBotOptions,
): MintBotBody {
  if (typeof body !== "object" || body === null) throw new Error("body must be an object");
  const { bot_id, operator_id, display_name, aliases, metadata, bot_public_key, operator_signature, message } =
    body as MintBotBody;
  if (typeof bot_id !== "string") throw new Error("bot_id is required");
  if (typeof operator_id !== "string") throw new Error("operator_id is required");
  if (typeof bot_public_key !== "string") throw new Error("bot_public_key is required");
  if (typeof operator_signature !== "string") throw new Error("operator_signature is required");
  if (typeof message !== "string") throw new Error("message is required");
  validateBotId(bot_id);
  validateOperatorId(operator_id);
  validatePublicKeyBase64(bot_public_key);
  validateSignatureBase64(operator_signature);
  if (!operators[operator_id]) throw new Error("operator_id does not exist");
  if (bots[bot_id]) throw new Error("bot_id already exists");
  if (display_name !== undefined && typeof display_name !== "string") throw new Error("display_name must be a string");
  if (aliases !== undefined && !Array.isArray(aliases)) throw new Error("aliases must be an array of strings");
  if (aliases && !aliases.every((a) => typeof a === "string")) throw new Error("aliases must be an array of strings");
  if (metadata !== undefined && typeof metadata !== "object") throw new Error("metadata must be an object");
  const expected = `mint-bot:${bot_id}:${operator_id}:${bot_public_key}:`;
  if (!message.startsWith(expected)) throw new Error("message does not match canonical format mint-bot:bot_id:operator_id:bot_public_key:timestamp");
  const timestamp = message.slice(expected.length);
  if (!timestamp) throw new Error("timestamp missing or not recent");
  if (!options?.skipTimestampRecency && !isTimestampRecent(timestamp)) throw new Error("timestamp missing or not recent");
  return { bot_id, operator_id, display_name, aliases, metadata, bot_public_key, operator_signature, message };
}

export function validateAddKeySigned(body: unknown, botId: string): AddKeySignedBody {
  if (typeof body !== "object" || body === null) throw new Error("body must be an object");
  const { public_key, operator_signature, message } = body as AddKeySignedBody;
  if (typeof public_key !== "string") throw new Error("public_key is required");
  if (typeof operator_signature !== "string") throw new Error("operator_signature is required");
  if (typeof message !== "string") throw new Error("message is required");
  validatePublicKeyBase64(public_key);
  validateSignatureBase64(operator_signature);
  const expected = `add-bot-key:${botId}:${public_key}:`;
  if (!message.startsWith(expected)) throw new Error("message does not match canonical format add-bot-key:bot_id:public_key:timestamp");
  const timestamp = message.slice(expected.length);
  if (!timestamp || !isTimestampRecent(timestamp)) throw new Error("timestamp missing or not recent");
  return { public_key, operator_signature, message };
}

export function validateCreateOperator(body: unknown): CreateOperatorBody {
  if (typeof body !== "object" || body === null) {
    throw new Error("body must be an object");
  }
  const { operator_id, display_name, public_keys } = body as CreateOperatorBody;
  if (typeof operator_id !== "string") {
    throw new Error("operator_id is required");
  }
  validateOperatorId(operator_id);
  if (display_name !== undefined && typeof display_name !== "string") {
    throw new Error("display_name must be a string");
  }
  if (public_keys !== undefined && !Array.isArray(public_keys)) {
    throw new Error("public_keys must be an array if provided");
  }
  return { operator_id, display_name, public_keys };
}

export function validateCreateBot(
  body: unknown,
  operators: Record<string, OperatorRecord>,
  bots: Record<string, BotRecord>,
): CreateBotBody {
  if (typeof body !== "object" || body === null) {
    throw new Error("body must be an object");
  }
  const { bot_id, display_name, operator_id, aliases, metadata } = body as CreateBotBody;
  if (typeof bot_id !== "string") throw new Error("bot_id is required");
  if (typeof operator_id !== "string") throw new Error("operator_id is required");
  validateBotId(bot_id);
  validateOperatorId(operator_id);
  if (!operators[operator_id]) {
    throw new Error("operator_id does not exist");
  }
  if (bots[bot_id]) {
    throw new Error("bot_id already exists");
  }
  if (display_name !== undefined && typeof display_name !== "string") {
    throw new Error("display_name must be a string");
  }
  if (aliases !== undefined && !Array.isArray(aliases)) {
    throw new Error("aliases must be an array of strings");
  }
  if (aliases && !aliases.every((a) => typeof a === "string")) {
    throw new Error("aliases must be an array of strings");
  }
  if (metadata !== undefined && typeof metadata !== "object") {
    throw new Error("metadata must be an object");
  }
  return { bot_id, display_name, operator_id, aliases, metadata };
}

export function validateAddKey(body: unknown): AddKeyBody {
  if (typeof body !== "object" || body === null) {
    throw new Error("body must be an object");
  }
  const { key_id, algorithm, public_key, metadata } = body as AddKeyBody;
  if (typeof algorithm !== "string" || algorithm.toLowerCase() !== "ed25519") {
    throw new Error("algorithm must be 'ed25519'");
  }
  if (typeof public_key !== "string") {
    throw new Error("public_key is required");
  }
  // Basic base64 validation
  try {
    const decoded = Buffer.from(public_key, "base64");
    if (decoded.length !== 32) {
      throw new Error("public_key must decode to 32 bytes");
    }
  } catch {
    throw new Error("public_key must be valid base64");
  }
  if (metadata !== undefined && typeof metadata !== "object") {
    throw new Error("metadata must be an object");
  }
  if (key_id !== undefined && typeof key_id !== "string") {
    throw new Error("key_id must be a string if provided");
  }
  return { key_id, algorithm, public_key, metadata };
}

