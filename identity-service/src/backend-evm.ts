import { promises as fs } from "fs";
import { decodeEventLog, keccak256, toBytes, type Hex, type Log } from "viem";
import { clankerIdentityAbi } from "./abi/clanker-identity";
import type { IdentityBackend, IdentityBackendHealth } from "./backend";
import { createIdentityPublicClient } from "./chain";
import type {
  BotRecord,
  IdentityLedger,
  IdentityLedgerMeta,
  OperatorRecord,
  PublicKeyRecord,
} from "./ledger";

export interface EvmBackendOptions {
  rpcUrl: string;
  registry: Hex;
  deploymentBlock: bigint;
  snapshotPath: string;
  pollMs: number;
  /** Max blocks per eth_getLogs request (RPC providers often cap range). */
  logChunkBlocks?: bigint;
}

interface OperatorState {
  label: string;
  owner: Hex;
  registeredAt: bigint;
  revokedAt: bigint;
  lastEventAt: bigint;
}

interface BotState {
  label: string;
  operatorIdBytes: Hex;
  botKey: Hex;
  registeredAt: bigint;
  revokedAt: bigint;
  lastEventAt: bigint;
}

function isoFromUnix(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString();
}

function idKeyFromLabel(label: string): Hex {
  return keccak256(toBytes(label)) as Hex;
}

/** Normalize bytes32 / address keys for consistent Map lookups (viem may checksum hex). */
function norm32(h: Hex): Hex {
  return h.toLowerCase() as Hex;
}

export class EvmBackend implements IdentityBackend {
  private readonly rpcUrl: string;
  private readonly registry: Hex;
  private readonly deploymentBlock: bigint;
  private readonly snapshotPath: string;
  private readonly pollMs: number;
  private readonly logChunkBlocks: bigint;

  private client = createIdentityPublicClient("http://127.0.0.1:0");
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private chainOk = false;
  private chainId = 0;
  /**
   * Highest block fully processed (inclusive). `-1n` means not yet synced.
   * Fetches use this block as the lower bound (inclusive) so new txs in the
   * same tail block are not missed when RPC briefly reports a stale head.
   */
  private lastIndexedBlock: bigint;

  private readonly seenLogKeys = new Set<string>();
  /** After hydrating from snapshot, first fetch starts at `lastIndexed+1` (no duplicate replay). */
  private preferExclusiveNextFetch = false;

  private readonly operatorById = new Map<Hex, OperatorState>();
  private readonly botById = new Map<Hex, BotState>();
  private readonly labelByOpId = new Map<Hex, string>();
  private readonly labelByBotId = new Map<Hex, string>();

  constructor(options: EvmBackendOptions) {
    this.rpcUrl = options.rpcUrl;
    this.registry = options.registry;
    this.deploymentBlock = options.deploymentBlock;
    this.snapshotPath = options.snapshotPath;
    this.pollMs = options.pollMs;
    this.logChunkBlocks = options.logChunkBlocks ?? 2000n;
    this.lastIndexedBlock = -1n;
  }

  /** Exposed for tests: clamp cursor when snapshot is ahead of chain head. */
  /** Fresh chain head (viem caches getBlockNumber by default). */
  private latestBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber({ cacheTime: 0 });
  }

  async reconcileHeadIfAhead(): Promise<void> {
    const head = await this.latestBlockNumber();
    const fromBlock = this.nextLogFromBlock();
    if (fromBlock > head) {
      await this.clampToHead(head);
    }
  }

  async start(): Promise<void> {
    this.client = createIdentityPublicClient(this.rpcUrl);
    const snap = await this.loadSnapshotFromDisk();
    if (
      snap?.meta?.registryAddress?.toLowerCase() === this.registry.toLowerCase() &&
      snap.meta.lastIndexedBlock !== undefined
    ) {
      this.hydrateFromSnapshot(snap);
      this.lastIndexedBlock = BigInt(snap.meta.lastIndexedBlock);
      this.preferExclusiveNextFetch = true;
      if (snap.meta.chainId !== undefined) {
        this.chainId = snap.meta.chainId;
      }
    }
    try {
      this.chainId = await this.client.getChainId();
      await this.catchUpToHead();
      this.chainOk = true;
    } catch (e) {
      this.chainOk = false;
      console.warn("[EvmBackend] RPC unreachable at start; serving snapshot if present.", e);
    }
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.pollMs);
  }

  stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    return this.flushSnapshot();
  }

  /** Final index attempt + persist (shutdown path). */
  async flushSnapshot(): Promise<void> {
    try {
      await this.indexThroughHead();
    } catch (e) {
      console.warn("[EvmBackend] final index on stop failed", e);
    }
    try {
      await this.persistSnapshot();
    } catch (e) {
      console.warn("[EvmBackend] failed to flush snapshot on stop", e);
    }
  }

  async health(): Promise<IdentityBackendHealth> {
    return {
      ok: this.chainOk,
      mode: "evm",
      chainId: this.chainId || undefined,
      registryAddress: this.registry,
      lastBlock: this.lastIndexedBlock >= 0n ? this.lastIndexedBlock.toString() : undefined,
      chainOk: this.chainOk,
    };
  }

  private async clampToHead(head: bigint): Promise<void> {
    this.preferExclusiveNextFetch = false;
    this.lastIndexedBlock = head;
    await this.persistSnapshot();
  }

  private async waitForHead(fromBlock: bigint): Promise<{ fromBlock: bigint; head: bigint }> {
    let head = await this.latestBlockNumber();
    let wait = 0;
    while (fromBlock > head && wait < 20) {
      await new Promise((r) => setTimeout(r, 25));
      head = await this.latestBlockNumber();
      wait++;
    }
    const latest = await this.latestBlockNumber();
    if (latest > head) head = latest;
    return { fromBlock, head };
  }

  private async fetchLogsInRange(fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
    if (fromBlock > toBlock) return [];
    const all: Log[] = [];
    let cursor = fromBlock;
    while (cursor <= toBlock) {
      const chunkEnd =
        cursor + this.logChunkBlocks - 1n > toBlock ? toBlock : cursor + this.logChunkBlocks - 1n;
      const chunk = await this.client.getLogs({
        address: this.registry,
        fromBlock: cursor,
        toBlock: chunkEnd,
      });
      all.push(...chunk);
      cursor = chunkEnd + 1n;
    }
    return all;
  }

  private async indexThroughHead(): Promise<void> {
    let fromBlock = this.nextLogFromBlock();
    const { head } = await this.waitForHead(fromBlock);
    if (fromBlock > head) {
      await this.clampToHead(head);
      return;
    }
    const logs = await this.fetchLogsInRange(fromBlock, head);
    this.preferExclusiveNextFetch = false;
    await this.applyLogs(logs);
    let tip = head;
    for (const l of logs) {
      if (l.blockNumber != null && l.blockNumber > tip) tip = l.blockNumber;
    }
    this.lastIndexedBlock = tip;
    this.pruneSeenKeys();
    await this.persistSnapshot();
  }

  private logDedupeKey(log: Log): string {
    if (log.transactionHash != null && log.logIndex != null) {
      return `${log.transactionHash}:${log.logIndex}`;
    }
    return `${log.blockNumber}:${log.data}:${(log.topics ?? []).join(",")}`;
  }

  private async loadSnapshotFromDisk(): Promise<IdentityLedger | null> {
    try {
      const raw = await fs.readFile(this.snapshotPath, "utf8");
      return JSON.parse(raw) as IdentityLedger;
    } catch {
      return null;
    }
  }

  private hydrateSecp256k1EthKey(
    publicKeys: PublicKeyRecord[] | undefined,
  ): PublicKeyRecord | undefined {
    if (!publicKeys?.length) return undefined;
    return (
      publicKeys.find((k) => k.algorithm === "secp256k1-eth" && k.status === "active") ??
      publicKeys.find((k) => k.algorithm === "secp256k1-eth" && k.status === "revoked")
    );
  }

  private hydrateFromSnapshot(ledger: IdentityLedger): void {
    this.operatorById.clear();
    this.botById.clear();
    this.labelByOpId.clear();
    this.labelByBotId.clear();

    for (const op of Object.values(ledger.operators)) {
      const id = norm32(idKeyFromLabel(op.operator_id));
      const ethKey = this.hydrateSecp256k1EthKey(op.public_keys);
      if (!ethKey?.public_key.startsWith("0x")) continue;
      const owner = ethKey.public_key as Hex;
      const reg = BigInt(Math.floor(Date.parse(op.created) / 1000));
      const revoked = op.status === "retired" ? BigInt(Math.floor(Date.parse(op.updated) / 1000)) : 0n;
      this.operatorById.set(id, {
        label: op.operator_id,
        owner,
        registeredAt: reg,
        revokedAt: revoked,
        lastEventAt: BigInt(Math.floor(Date.parse(op.updated) / 1000)),
      });
      this.labelByOpId.set(id, op.operator_id);
    }

    for (const bot of Object.values(ledger.bots)) {
      const id = norm32(idKeyFromLabel(bot.bot_id));
      const ethKey = this.hydrateSecp256k1EthKey(bot.public_keys);
      if (!ethKey?.public_key.startsWith("0x")) continue;
      const operatorIdBytes = norm32(idKeyFromLabel(bot.operator_id));
      const reg = BigInt(Math.floor(Date.parse(bot.created) / 1000));
      const revoked = bot.status === "retired" ? BigInt(Math.floor(Date.parse(bot.updated) / 1000)) : 0n;
      this.botById.set(id, {
        label: bot.bot_id,
        operatorIdBytes,
        botKey: ethKey.public_key as Hex,
        registeredAt: reg,
        revokedAt: revoked,
        lastEventAt: BigInt(Math.floor(Date.parse(bot.updated) / 1000)),
      });
      this.labelByBotId.set(id, bot.bot_id);
    }
  }

  private nextLogFromBlock(): bigint {
    if (this.lastIndexedBlock < 0n) {
      return this.deploymentBlock;
    }
    if (this.preferExclusiveNextFetch) {
      return this.lastIndexedBlock + 1n;
    }
    return this.lastIndexedBlock;
  }

  private pruneSeenKeys(): void {
    if (this.seenLogKeys.size < 50_000) return;
    this.seenLogKeys.clear();
  }

  private async catchUpToHead(): Promise<void> {
    await this.indexThroughHead();
  }

  /** Pull logs through current head (for tests or manual refresh). */
  async syncFromChain(): Promise<void> {
    await this.pollOnce();
  }

  private async pollOnce(): Promise<void> {
    try {
      await this.indexThroughHead();
      this.chainOk = true;
    } catch (e) {
      this.chainOk = false;
      console.warn("[EvmBackend] poll failed", e);
    }
  }

  private async applyLogs(logs: Log[]): Promise<void> {
    const sorted = [...logs].sort((a, b) => {
      const bn = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
      if (bn !== 0) return bn;
      return (a.logIndex ?? 0) - (b.logIndex ?? 0);
    });
    const tsCache = new Map<string, bigint>();
    for (const log of sorted) {
      if (!log.blockNumber) continue;
      const dk = this.logDedupeKey(log);
      if (this.seenLogKeys.has(dk)) continue;
      this.seenLogKeys.add(dk);
      const bn = log.blockNumber;
      const k = bn.toString();
      let ts = tsCache.get(k);
      if (ts === undefined) {
        const block = await this.client.getBlock({ blockNumber: bn });
        ts = block.timestamp;
        tsCache.set(k, ts);
      }
      let decoded;
      try {
        decoded = decodeEventLog({
          abi: clankerIdentityAbi,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        continue;
      }
      switch (decoded.eventName) {
        case "OperatorRegistered": {
          const { id, owner, label } = decoded.args;
          const idN = norm32(id);
          this.operatorById.set(idN, {
            label,
            owner: owner as Hex,
            registeredAt: ts,
            revokedAt: 0n,
            lastEventAt: ts,
          });
          this.labelByOpId.set(idN, label);
          break;
        }
        case "OperatorTransferred": {
          const { id, newOwner } = decoded.args;
          const idN = norm32(id);
          const st = this.operatorById.get(idN);
          if (st) {
            st.owner = newOwner as Hex;
            st.lastEventAt = ts;
          }
          break;
        }
        case "OperatorRevoked": {
          const { id } = decoded.args;
          const idN = norm32(id);
          const st = this.operatorById.get(idN);
          if (st) {
            st.revokedAt = ts;
            st.lastEventAt = ts;
          }
          break;
        }
        case "BotRegistered": {
          const { id, operatorId, botKey, label } = decoded.args;
          const idN = norm32(id);
          this.botById.set(idN, {
            label,
            operatorIdBytes: norm32(operatorId as Hex),
            botKey: botKey as Hex,
            registeredAt: ts,
            revokedAt: 0n,
            lastEventAt: ts,
          });
          this.labelByBotId.set(idN, label);
          break;
        }
        case "BotKeyRotated": {
          const { id, newKey } = decoded.args;
          const idN = norm32(id);
          const st = this.botById.get(idN);
          if (st) {
            st.botKey = newKey as Hex;
            st.lastEventAt = ts;
          }
          break;
        }
        case "BotRevoked": {
          const { id } = decoded.args;
          const idN = norm32(id);
          const st = this.botById.get(idN);
          if (st) {
            st.revokedAt = ts;
            st.lastEventAt = ts;
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private operatorLabelFor(operatorIdBytes: Hex): string {
    return this.labelByOpId.get(norm32(operatorIdBytes)) ?? operatorIdBytes;
  }

  private materializeOperator(label: string): OperatorRecord | undefined {
    const id = norm32(idKeyFromLabel(label));
    const st = this.operatorById.get(id);
    if (!st) return undefined;
    const keyId = `${st.label}-${st.registeredAt.toString()}`;
    const pk: PublicKeyRecord = {
      key_id: keyId,
      algorithm: "secp256k1-eth",
      public_key: st.owner,
      created: isoFromUnix(st.registeredAt),
      status: st.revokedAt > 0n ? "revoked" : "active",
    };
    return {
      operator_id: st.label,
      status: st.revokedAt > 0n ? "retired" : "active",
      created: isoFromUnix(st.registeredAt),
      updated: isoFromUnix(st.lastEventAt),
      public_keys: [pk],
    };
  }

  private materializeBot(label: string): BotRecord | undefined {
    const id = norm32(idKeyFromLabel(label));
    const st = this.botById.get(id);
    if (!st) return undefined;
    const operatorIdStr = this.operatorLabelFor(st.operatorIdBytes);
    const keyId = `${st.label}-${st.registeredAt.toString()}`;
    const pk: PublicKeyRecord = {
      key_id: keyId,
      algorithm: "secp256k1-eth",
      public_key: st.botKey,
      created: isoFromUnix(st.registeredAt),
      status: st.revokedAt > 0n ? "revoked" : "active",
    };
    return {
      bot_id: st.label,
      operator_id: operatorIdStr,
      status: st.revokedAt > 0n ? "retired" : "active",
      created: isoFromUnix(st.registeredAt),
      updated: isoFromUnix(st.lastEventAt),
      public_keys: [pk],
    };
  }

  async getBot(botId: string): Promise<BotRecord | undefined> {
    return this.materializeBot(botId);
  }

  async getOperator(operatorId: string): Promise<OperatorRecord | undefined> {
    return this.materializeOperator(operatorId);
  }

  async getLedgerSnapshot(): Promise<IdentityLedger> {
    const operators: Record<string, OperatorRecord> = {};
    for (const st of this.operatorById.values()) {
      const rec = this.materializeOperator(st.label);
      if (rec) operators[rec.operator_id] = rec;
    }
    const bots: Record<string, BotRecord> = {};
    for (const st of this.botById.values()) {
      const rec = this.materializeBot(st.label);
      if (rec) bots[rec.bot_id] = rec;
    }
    const now = new Date().toISOString();
    const meta: IdentityLedgerMeta = {
      lastIndexedBlock: this.lastIndexedBlock >= 0n ? this.lastIndexedBlock.toString() : "0",
      chainId: this.chainId,
      registryAddress: this.registry,
    };
    return {
      $schema: "https://example.com/schemas/bot-identity-ledger.schema.json",
      version: 1,
      created: now,
      updated: now,
      operators,
      bots,
      operations: [],
      meta,
    };
  }

  private async persistSnapshot(): Promise<void> {
    const ledger = await this.getLedgerSnapshot();
    const tmpPath = `${this.snapshotPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(ledger, null, 2), "utf8");
    await fs.rename(tmpPath, this.snapshotPath);
  }

}
