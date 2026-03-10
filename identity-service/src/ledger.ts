import { promises as fs } from "fs";

export type PublicKeyStatus = "active" | "revoked";

export interface PublicKeyRecord {
  key_id: string;
  algorithm: string;
  public_key: string;
  created: string;
  status: PublicKeyStatus;
  metadata?: Record<string, unknown>;
}

export interface OperatorRecord {
  operator_id: string;
  display_name?: string;
  public_keys?: PublicKeyRecord[];
  status: "active" | "suspended" | "retired";
  created: string;
  updated: string;
  metadata?: Record<string, unknown>;
}

export interface BotRecord {
  bot_id: string;
  display_name?: string;
  operator_id: string;
  aliases?: string[];
  public_keys?: PublicKeyRecord[];
  status: "active" | "suspended" | "retired";
  created: string;
  updated: string;
  metadata?: Record<string, unknown>;
}

export type OperationType = "mint-operator" | "mint-bot" | "add-bot-key";

export interface OperationRecord {
  op_id: string;
  type: OperationType;
  timestamp: string;
  operator_id?: string;
  public_key?: string;
  signature?: string;
  message?: string;
  bot_id?: string;
  bot_public_key?: string;
  operator_signature?: string;
}

export interface IdentityLedger {
  $schema?: string;
  version: number;
  created: string;
  updated: string;
  operators: Record<string, OperatorRecord>;
  bots: Record<string, BotRecord>;
  operations: OperationRecord[];
}

// Ledger file: use IDENTITY_LEDGER_PATH if set, else repo's identity/ directory.
const defaultLedgerPath = new URL("../../identity/bot-identity-ledger.json", import.meta.url).pathname;
const ledgerPath = Bun.env.IDENTITY_LEDGER_PATH ?? defaultLedgerPath;

let ledger: IdentityLedger | null = null;

// Simple in-process write lock to serialize ledger writes.
let writeLock: Promise<void> = Promise.resolve();

export async function loadLedger(): Promise<IdentityLedger> {
  if (ledger) return ledger;
  const data = await fs.readFile(ledgerPath, "utf8");
  const parsed = JSON.parse(data) as IdentityLedger;
  // Basic shape checks; detailed validation happens elsewhere.
  if (!parsed.operators) parsed.operators = {};
  if (!parsed.bots) parsed.bots = {};
  if (!Array.isArray(parsed.operations)) parsed.operations = [];
  ledger = parsed;
  return ledger;
}

async function persistLedger(current: IdentityLedger): Promise<void> {
  const now = new Date().toISOString();
  current.updated = now;
  const tmpPath = `${ledgerPath}.tmp`;
  const json = JSON.stringify(current, null, 2);
  await fs.writeFile(tmpPath, json, "utf8");
  await fs.rename(tmpPath, ledgerPath);
}

async function withWriteLock(fn: (current: IdentityLedger) => Promise<void>): Promise<void> {
  writeLock = writeLock.then(async () => {
    const current = await loadLedger();
    await fn(current);
    await persistLedger(current);
  });
  return writeLock;
}

export async function getLedgerSnapshot(): Promise<IdentityLedger> {
  const current = await loadLedger();
  // Return a shallow clone to avoid external mutation.
  return structuredClone(current);
}

export async function upsertOperator(record: OperatorRecord): Promise<void> {
  await withWriteLock(async (current) => {
    current.operators[record.operator_id] = record;
  });
}

export async function upsertBot(record: BotRecord): Promise<void> {
  await withWriteLock(async (current) => {
    current.bots[record.bot_id] = record;
  });
}

export async function addBotKey(botId: string, key: PublicKeyRecord): Promise<void> {
  await withWriteLock(async (current) => {
    const bot = current.bots[botId];
    if (!bot) {
      throw new Error(`Bot not found: ${botId}`);
    }
    if (!bot.public_keys) bot.public_keys = [];
    const exists = bot.public_keys.some(
      (k) => k.public_key === key.public_key && k.status === "active",
    );
    if (exists) {
      return;
    }
    bot.public_keys.push(key);
    bot.updated = new Date().toISOString();
  });
}

export async function revokeBotKey(botId: string, keyId: string): Promise<void> {
  await withWriteLock(async (current) => {
    const bot = current.bots[botId];
    if (!bot || !bot.public_keys) return;
    const key = bot.public_keys.find((k) => k.key_id === keyId);
    if (!key) return;
    key.status = "revoked";
    bot.updated = new Date().toISOString();
  });
}

export async function getBot(botId: string): Promise<BotRecord | undefined> {
  const current = await loadLedger();
  return current.bots[botId];
}

export async function getOperator(operatorId: string): Promise<OperatorRecord | undefined> {
  const current = await loadLedger();
  return current.operators[operatorId];
}

function nextOpId(operations: OperationRecord[]): string {
  const n = operations.length + 1;
  return `op-${String(n).padStart(3, "0")}`;
}

export async function appendOperation(record: Omit<OperationRecord, "op_id">): Promise<void> {
  await withWriteLock(async (current) => {
    const opId = nextOpId(current.operations);
    current.operations.push({ ...record, op_id: opId });
  });
}

