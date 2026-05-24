import type { BotRecord, IdentityLedger, OperatorRecord } from "./ledger";

export interface IdentityBackendHealth {
  ok: boolean;
  mode: "evm";
  chainId?: number;
  registryAddress?: string;
  /** Latest fully indexed block (stringified bigint). */
  lastBlock?: string;
  chainOk?: boolean;
  error?: string;
}

export interface IdentityBackend {
  getBot(botId: string): Promise<BotRecord | undefined>;
  getOperator(operatorId: string): Promise<OperatorRecord | undefined>;
  getLedgerSnapshot(): Promise<IdentityLedger>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  health(): Promise<IdentityBackendHealth>;
}
