/**
 * On-chain ClankerIdentity reader (shared by bots + mqtt-auth).
 */
import {
  createPublicClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { clankerIdentityAbi } from "./abi/clanker-identity.js";
import type { ClankerEip712Domain } from "./eip712.js";
import type { BotRecord, OperatorRecord } from "./types.js";

export interface RegistryClientOptions {
  rpcUrl: string;
  registryAddress: Address;
  /** Optional pinned chain id; must match eth_chainId when set. */
  chainId?: number;
  /** Cache TTL for label/id lookups (default 10s). Use `0` to disable.
   * mqtt-auth defaults to `0` so revoke/rotate take effect immediately.
   * Bot `IdentityClient` keeps the 10s default for public-RPC rate limits on
   * `init` / `verifyMessage` — revoked peers may still verify for up to TTL. */
  cacheTtlMs?: number;
  /** HTTP timeout for RPC transport in ms (viem `http` timeout). Default 10_000. */
  rpcTimeoutMs?: number;
  /** Test injection. */
  publicClient?: PublicClient;
}

export interface OnchainBot {
  botId: string;
  operatorId: Hex;
  botKey: Address;
  status: "active" | "retired";
  registeredAt: bigint;
  revokedAt: bigint;
}

export interface OnchainOperator {
  owner: Address;
  status: "active" | "retired";
  registeredAt: bigint;
  revokedAt: bigint;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

function labelToId(label: string): Hex {
  return keccak256(toBytes(label)) as Hex;
}

function isoFromUnix(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString();
}

export function onchainBotToRecord(bot: OnchainBot, operatorLabel?: string): BotRecord {
  const created = isoFromUnix(bot.registeredAt);
  const updated = bot.revokedAt > 0n ? isoFromUnix(bot.revokedAt) : created;
  return {
    bot_id: bot.botId,
    operator_id: operatorLabel ?? bot.operatorId,
    status: bot.status,
    created,
    updated,
    public_keys:
      bot.botKey && bot.botKey !== "0x0000000000000000000000000000000000000000"
        ? [
            {
              key_id: `${bot.botId}-eth`,
              algorithm: "secp256k1-eth",
              public_key: bot.botKey,
              created,
              status: bot.status === "active" ? "active" : "revoked",
            },
          ]
        : [],
  };
}

export function onchainOperatorToRecord(
  operatorId: string,
  op: OnchainOperator,
): OperatorRecord {
  const created = isoFromUnix(op.registeredAt);
  const updated = op.revokedAt > 0n ? isoFromUnix(op.revokedAt) : created;
  return {
    operator_id: operatorId,
    status: op.status,
    created,
    updated,
    public_keys: [
      {
        key_id: `${operatorId}-owner`,
        algorithm: "secp256k1-eth",
        public_key: op.owner,
        created,
        status: op.status === "active" ? "active" : "revoked",
      },
    ],
  };
}

export class RegistryClient {
  private readonly client: PublicClient;
  private readonly registry: Address;
  private readonly pinnedChainId?: number;
  private readonly cacheTtlMs: number;
  private readonly botCache = new Map<string, CacheEntry<OnchainBot | null>>();
  private readonly operatorByLabelCache = new Map<string, CacheEntry<OnchainOperator | null>>();
  private readonly operatorByIdCache = new Map<string, CacheEntry<OnchainOperator | null>>();
  private cachedChainId?: number;

  constructor(options: RegistryClientOptions) {
    this.registry = options.registryAddress;
    this.pinnedChainId = options.chainId;
    const ttl = options.cacheTtlMs;
    this.cacheTtlMs =
      typeof ttl === "number" && Number.isFinite(ttl) && ttl >= 0 ? ttl : 10_000;
    const rpcTimeout =
      typeof options.rpcTimeoutMs === "number" &&
      Number.isFinite(options.rpcTimeoutMs) &&
      options.rpcTimeoutMs > 0
        ? options.rpcTimeoutMs
        : 10_000;
    this.client =
      options.publicClient ??
      createPublicClient({
        transport: http(options.rpcUrl, {
          timeout: rpcTimeout,
        }),
      });
  }

  async getChainId(): Promise<number> {
    if (this.cachedChainId !== undefined) return this.cachedChainId;
    const id = Number(await this.client.getChainId());
    if (this.pinnedChainId !== undefined && id !== this.pinnedChainId) {
      throw new Error(
        `RPC chainId ${id} does not match pinned chainId ${this.pinnedChainId}`,
      );
    }
    this.cachedChainId = id;
    return id;
  }

  /**
   * Uncached liveness probe for healthchecks (always hits RPC).
   * Prefer this over `getChainId()` when you need to detect RPC outages.
   */
  async probeRpc(): Promise<{ chainId: number; blockNumber: bigint }> {
    const [chainIdRaw, blockNumber] = await Promise.all([
      this.client.getChainId(),
      this.client.getBlockNumber(),
    ]);
    const chainId = Number(chainIdRaw);
    if (this.pinnedChainId !== undefined && chainId !== this.pinnedChainId) {
      throw new Error(
        `RPC chainId ${chainId} does not match pinned chainId ${this.pinnedChainId}`,
      );
    }
    this.cachedChainId = chainId;
    return { chainId, blockNumber };
  }

  async getEip712Domain(): Promise<ClankerEip712Domain> {
    const chainId = await this.getChainId();
    return { chainId, registryAddress: this.registry };
  }

  async getBotByLabel(label: string): Promise<OnchainBot | null> {
    if (this.cacheTtlMs > 0) {
      const cached = this.botCache.get(label);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }

    const id = labelToId(label);
    const row = await this.client.readContract({
      address: this.registry,
      abi: clankerIdentityAbi,
      functionName: "bots",
      args: [id],
    });
    const [operatorId, botKey, registeredAt, revokedAt] = row as readonly [
      Hex,
      Address,
      bigint,
      bigint,
    ];
    let value: OnchainBot | null = null;
    if (registeredAt !== 0n) {
      value = {
        botId: label,
        operatorId,
        botKey,
        registeredAt,
        revokedAt,
        status: revokedAt === 0n ? "active" : "retired",
      };
    }
    if (this.cacheTtlMs > 0) {
      this.botCache.set(label, { value, expiresAt: Date.now() + this.cacheTtlMs });
    }
    return value;
  }

  async getOperatorByLabel(label: string): Promise<OnchainOperator | null> {
    if (this.cacheTtlMs > 0) {
      const cached = this.operatorByLabelCache.get(label);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }
    const value = await this.getOperatorById(labelToId(label));
    if (this.cacheTtlMs > 0) {
      this.operatorByLabelCache.set(label, {
        value,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }
    return value;
  }

  async getOperatorById(operatorId: Hex): Promise<OnchainOperator | null> {
    const key = operatorId.toLowerCase();
    if (this.cacheTtlMs > 0) {
      const cached = this.operatorByIdCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }

    const row = await this.client.readContract({
      address: this.registry,
      abi: clankerIdentityAbi,
      functionName: "operators",
      args: [operatorId],
    });
    const [owner, registeredAt, revokedAt] = row as readonly [Address, bigint, bigint];
    let value: OnchainOperator | null = null;
    if (registeredAt !== 0n) {
      value = {
        owner,
        registeredAt,
        revokedAt,
        status: revokedAt === 0n ? "active" : "retired",
      };
    }
    if (this.cacheTtlMs > 0) {
      this.operatorByIdCache.set(key, {
        value,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }
    return value;
  }

  /** Invalidate caches (tests / after known on-chain mutation). */
  clearCache(): void {
    this.botCache.clear();
    this.operatorByLabelCache.clear();
    this.operatorByIdCache.clear();
    this.cachedChainId = undefined;
  }
}

export { labelToId as registryLabelToId };
