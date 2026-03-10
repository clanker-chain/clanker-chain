import type { BotRecord, OperatorRecord, PublicKeyRecord } from "./ledger";

const OPERATOR_ID_REGEX = /^[a-z0-9_.-]+$/;
// namespace.role.instance
const BOT_ID_REGEX = /^[a-z0-9_.-]+\.[a-z0-9_.-]+\.[a-z0-9_.-]+$/;

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

