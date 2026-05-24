/**
 * Identity ledger types. On-chain state is materialized by `EvmBackend`.
 *
 * `algorithm` on `PublicKeyRecord` is `"secp256k1-eth"` (`public_key` is a 0x-prefixed address).
 */

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

export interface IdentityLedgerMeta {
  lastIndexedBlock?: string;
  chainId?: number;
  registryAddress?: string;
}

export interface IdentityLedger {
  $schema?: string;
  version: number;
  created: string;
  updated: string;
  operators: Record<string, OperatorRecord>;
  bots: Record<string, BotRecord>;
  operations: OperationRecord[];
  meta?: IdentityLedgerMeta;
}

export function getDefaultLedgerPath(): string {
  return new URL("../../identity/bot-identity-ledger.json", import.meta.url).pathname;
}
