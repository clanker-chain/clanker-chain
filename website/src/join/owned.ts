/**
 * Read operators/bots owned by an address via event logs + storage refresh.
 * Slim browser port of packages/clanker-cli/lib/identity-query.mjs.
 */

import {
  getAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { clankerIdentityAbi } from "./abi";
import { SEPOLIA_FAST_FROM_BLOCK, SEPOLIA_REGISTRY } from "./constants";
import { labelToId } from "./utils";

/** Minimal client surface — avoid coupling to a specific viem PublicClient generic. */
type LogClient = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (params: Record<string, unknown>) => Promise<
    Array<{
      args?: Record<string, unknown> | undefined;
      transactionHash: Hex | null;
    }>
  >;
  readContract: (params: {
    address: Address;
    abi: typeof clankerIdentityAbi;
    functionName: "operators" | "bots";
    args: [Hex];
  }) => Promise<readonly unknown[]>;
};

const OPERATOR_REGISTERED = parseAbiItem(
  "event OperatorRegistered(bytes32 indexed id, address indexed owner, string label)",
);
const OPERATOR_TRANSFERRED = parseAbiItem(
  "event OperatorTransferred(bytes32 indexed id, address indexed oldOwner, address indexed newOwner)",
);
const BOT_REGISTERED = parseAbiItem(
  "event BotRegistered(bytes32 indexed id, bytes32 indexed operatorId, address indexed botKey, string label)",
);

const CHUNK_PRIMARY = 10_000n;
const CHUNK_FALLBACK = 2_000n;
const LOOKUP_TIMEOUT_MS = 25_000;

export type OwnedBot = {
  label: string;
  id: Hex;
  botKey: Address;
  active: boolean;
};

export type OwnedOperator = {
  label: string;
  id: Hex;
  owner: Address;
  active: boolean;
  bots: OwnedBot[];
};

export type OwnedLookup =
  | { status: "ok"; operators: OwnedOperator[] }
  | { status: "error"; message: string; operators: OwnedOperator[] };

async function getLogsChunked(
  pub: LogClient,
  params: {
    address: Address;
    event: typeof OPERATOR_REGISTERED | typeof OPERATOR_TRANSFERRED | typeof BOT_REGISTERED;
    args?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  },
  chunkBlocks: bigint,
): Promise<
  Array<{
    args: Record<string, unknown>;
    transactionHash: Hex | null;
  }>
> {
  const all: Array<{
    args: Record<string, unknown>;
    transactionHash: Hex | null;
  }> = [];
  let cursor = params.fromBlock;
  while (cursor <= params.toBlock) {
    const chunkEnd =
      cursor + chunkBlocks - 1n > params.toBlock
        ? params.toBlock
        : cursor + chunkBlocks - 1n;
    const chunk = await pub.getLogs({
      address: params.address,
      event: params.event,
      args: params.args,
      fromBlock: cursor,
      toBlock: chunkEnd,
    });
    for (const log of chunk) {
      all.push({
        args: (log.args ?? {}) as Record<string, unknown>,
        transactionHash: log.transactionHash,
      });
    }
    cursor = chunkEnd + 1n;
  }
  return all;
}

async function withChunkFallback<T>(
  run: (chunkBlocks: bigint) => Promise<T>,
): Promise<T> {
  try {
    return await run(CHUNK_PRIMARY);
  } catch {
    return await run(CHUNK_FALLBACK);
  }
}

async function findOperatorsByOwner(
  pub: LogClient,
  owner: Address,
  fromBlock: bigint,
  toBlock: bigint,
  chunkBlocks: bigint,
): Promise<OwnedOperator[]> {
  const registry = SEPOLIA_REGISTRY;
  const ownerChecksum = getAddress(owner);

  const registeredLogs = await getLogsChunked(
    pub,
    {
      address: registry,
      event: OPERATOR_REGISTERED,
      args: { owner: ownerChecksum },
      fromBlock,
      toBlock,
    },
    chunkBlocks,
  );

  const transferredLogs = await getLogsChunked(
    pub,
    {
      address: registry,
      event: OPERATOR_TRANSFERRED,
      args: { newOwner: ownerChecksum },
      fromBlock,
      toBlock,
    },
    chunkBlocks,
  );

  const byId = new Map<string, { id: Hex; label?: string }>();

  for (const log of registeredLogs) {
    const id = log.args.id as Hex | undefined;
    const label = log.args.label as string | undefined;
    if (!id) continue;
    byId.set(id.toLowerCase(), { id, label });
  }

  for (const log of transferredLogs) {
    const id = log.args.id as Hex | undefined;
    if (!id) continue;
    const key = id.toLowerCase();
    if (!byId.has(key)) byId.set(key, { id });
  }

  for (const entry of byId.values()) {
    if (entry.label) continue;
    const labelLogs = await getLogsChunked(
      pub,
      {
        address: registry,
        event: OPERATOR_REGISTERED,
        args: { id: entry.id },
        fromBlock,
        toBlock,
      },
      chunkBlocks,
    );
    const last = labelLogs[labelLogs.length - 1];
    const label = last?.args?.label as string | undefined;
    if (label) entry.label = label;
  }

  const results: OwnedOperator[] = [];
  for (const entry of byId.values()) {
    if (!entry.label) continue;
    const row = await pub.readContract({
      address: registry,
      abi: clankerIdentityAbi,
      functionName: "operators",
      args: [entry.id],
    });
    const storageOwner = row[0] as Address;
    const registeredAt = row[1] as bigint | number;
    const revokedAt = row[2] as bigint | number;
    if (getAddress(storageOwner) !== ownerChecksum) continue;
    const registered = BigInt(registeredAt);
    const revoked = BigInt(revokedAt);
    const active = registered > 0n && revoked === 0n;
    if (!active) continue;
    results.push({
      label: entry.label,
      id: entry.id,
      owner: storageOwner,
      active,
      bots: [],
    });
  }
  return results;
}

async function findBotsByOperator(
  pub: LogClient,
  operatorId: Hex,
  fromBlock: bigint,
  toBlock: bigint,
  chunkBlocks: bigint,
): Promise<OwnedBot[]> {
  const registry = SEPOLIA_REGISTRY;
  const logs = await getLogsChunked(
    pub,
    {
      address: registry,
      event: BOT_REGISTERED,
      args: { operatorId },
      fromBlock,
      toBlock,
    },
    chunkBlocks,
  );

  const byLabel = new Map<string, { label: string; id: Hex }>();
  for (const log of logs) {
    const label = log.args.label as string | undefined;
    const id = log.args.id as Hex | undefined;
    if (!label || !id) continue;
    byLabel.set(label, { label, id });
  }

  const results: OwnedBot[] = [];
  for (const entry of byLabel.values()) {
    const row = await pub.readContract({
      address: registry,
      abi: clankerIdentityAbi,
      functionName: "bots",
      args: [entry.id],
    });
    const botKey = row[1] as Address;
    const registeredAt = row[2] as bigint | number;
    const revokedAt = row[3] as bigint | number;
    const registered = BigInt(registeredAt);
    const revoked = BigInt(revokedAt);
    const active = registered > 0n && revoked === 0n;
    if (!active) continue;
    results.push({
      label: entry.label,
      id: entry.id,
      botKey,
      active,
    });
  }
  return results;
}

/**
 * Merge a just-minted pair into the owned list (log indexers lag).
 */
export function mergeMintIntoOwned(
  operators: OwnedOperator[],
  mint: { operatorLabel: string; botLabel: string; botAddress: Address },
  owner: Address,
): OwnedOperator[] {
  const next = operators.map((op) => ({
    ...op,
    bots: [...op.bots],
  }));
  let op = next.find((o) => o.label === mint.operatorLabel);
  if (!op) {
    op = {
      label: mint.operatorLabel,
      id: labelToId(mint.operatorLabel),
      owner,
      active: true,
      bots: [],
    };
    next.unshift(op);
  }
  if (!op.bots.some((b) => b.label === mint.botLabel)) {
    op.bots.push({
      label: mint.botLabel,
      id: labelToId(mint.botLabel),
      botKey: mint.botAddress,
      active: true,
    });
  }
  return next;
}

export async function loadOwnedIdentities(
  pub: LogClient,
  owner: Address,
): Promise<OwnedLookup> {
  const run = async (): Promise<OwnedLookup> => {
    try {
      const toBlock = await pub.getBlockNumber();
      const fromBlock = SEPOLIA_FAST_FROM_BLOCK;
      if (fromBlock > toBlock) {
        return { status: "ok", operators: [] };
      }

      const operators = await withChunkFallback(async (chunkBlocks) => {
        const ops = await findOperatorsByOwner(
          pub,
          owner,
          fromBlock,
          toBlock,
          chunkBlocks,
        );
        for (const op of ops) {
          op.bots = await findBotsByOperator(
            pub,
            op.id,
            fromBlock,
            toBlock,
            chunkBlocks,
          );
        }
        return ops;
      });

      operators.sort((a, b) => a.label.localeCompare(b.label));
      for (const op of operators) {
        op.bots.sort((a, b) => a.label.localeCompare(b.label));
      }

      return { status: "ok", operators };
    } catch (e) {
      return {
        status: "error",
        message:
          e instanceof Error
            ? e.message
            : "Couldn’t load your names from the registry",
        operators: [],
      };
    }
  };

  return await Promise.race([
    run(),
    new Promise<OwnedLookup>((resolve) => {
      const timer = globalThis.setTimeout(() => {
        resolve({
          status: "error",
          message: "Lookup timed out — you can still register a name",
          operators: [],
        });
      }, LOOKUP_TIMEOUT_MS);
      // Prefer unref in Node so scripts can exit; browsers ignore unref.
      if (typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref: () => void }).unref();
      }
    }),
  ]);
}
