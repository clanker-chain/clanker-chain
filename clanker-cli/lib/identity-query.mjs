/**
 * Read-only identity queries via contract storage + event logs.
 */

import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  toBytes,
  parseAbiItem,
} from "viem";
import { clankerIdentityAbi } from "./clanker-identity-abi.mjs";

/** Match identity-service EVM_LOG_CHUNK_BLOCKS — public RPCs reject wide ranges. */
export const LOG_CHUNK_BLOCKS = 2000n;

export function labelToId(label) {
  return keccak256(toBytes(label));
}

const OPERATOR_REGISTERED = parseAbiItem(
  "event OperatorRegistered(bytes32 indexed id, address indexed owner, string label)",
);
const OPERATOR_TRANSFERRED = parseAbiItem(
  "event OperatorTransferred(bytes32 indexed id, address indexed oldOwner, address indexed newOwner)",
);
const BOT_REGISTERED = parseAbiItem(
  "event BotRegistered(bytes32 indexed id, bytes32 indexed operatorId, address indexed botKey, string label)",
);

/**
 * @param {string} rpc
 */
export async function publicClientFromRpc(rpc) {
  const transport = http(rpc);
  const bare = createPublicClient({ transport });
  const id = await bare.getChainId();
  const chain = defineChain({
    id,
    name: `clanker-chain-${id}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  return createPublicClient({ chain, transport });
}

/**
 * eth_getLogs in fixed-size block chunks (public RPC safe).
 *
 * @param {{ getLogs: Function, getBlockNumber?: Function }} pub
 * @param {object} params — viem getLogs params; fromBlock required; toBlock may be "latest"
 * @param {{ chunkBlocks?: bigint }} [opts]
 */
export async function getLogsChunked(pub, params, opts = {}) {
  const chunkBlocks = opts.chunkBlocks ?? LOG_CHUNK_BLOCKS;
  let fromBlock = params.fromBlock ?? 0n;
  if (typeof fromBlock === "number") fromBlock = BigInt(fromBlock);

  let toBlock = params.toBlock ?? "latest";
  if (toBlock === "latest") {
    if (typeof pub.getBlockNumber !== "function") {
      throw new Error("getLogsChunked: pub.getBlockNumber required when toBlock is latest");
    }
    toBlock = await pub.getBlockNumber();
  } else if (typeof toBlock === "number") {
    toBlock = BigInt(toBlock);
  }

  if (fromBlock > toBlock) return [];

  const all = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const chunkEnd =
      cursor + chunkBlocks - 1n > toBlock ? toBlock : cursor + chunkBlocks - 1n;
    const chunk = await pub.getLogs({
      ...params,
      fromBlock: cursor,
      toBlock: chunkEnd,
    });
    all.push(...chunk);
    cursor = chunkEnd + 1n;
  }
  return all;
}

/**
 * @param {import('viem').PublicClient} pub
 * @param {string} registry
 * @param {string} label
 */
export async function readOperator(pub, registry, label) {
  const id = labelToId(label);
  const [owner, registeredAt, revokedAt] = await pub.readContract({
    address: /** @type {`0x${string}`} */ (registry),
    abi: clankerIdentityAbi,
    functionName: "operators",
    args: [id],
  });
  return {
    label,
    id,
    owner,
    registeredAt: BigInt(registeredAt),
    revokedAt: BigInt(revokedAt),
    active: registeredAt > 0n && revokedAt === 0n,
  };
}

/**
 * Preferred-label path: storage read, no logs. Requires current owner + active.
 *
 * @param {import('viem').PublicClient} pub
 * @param {{ registry: string, label: string, owner: `0x${string}` }} opts
 */
export async function resolvePreferredOperator(pub, opts) {
  const op = await readOperator(pub, opts.registry, opts.label);
  if (op.registeredAt === 0n) {
    return {
      error: `Operator "${opts.label}" is not registered`,
      candidates: [],
    };
  }
  if (!op.active) {
    return {
      error: `Operator "${opts.label}" is revoked`,
      candidates: [],
    };
  }
  const want = getAddress(opts.owner);
  const got = getAddress(op.owner);
  if (want !== got) {
    return {
      error: `Operator "${opts.label}" is owned by ${got}, not ${want}`,
      candidates: [],
    };
  }
  return { operator: op };
}

/**
 * @param {import('viem').PublicClient} pub
 * @param {string} registry
 * @param {string} label
 */
export async function readBot(pub, registry, label) {
  const id = labelToId(label);
  const [operatorId, botKey, registeredAt, revokedAt] = await pub.readContract({
    address: /** @type {`0x${string}`} */ (registry),
    abi: clankerIdentityAbi,
    functionName: "bots",
    args: [id],
  });
  return {
    label,
    id,
    operatorId,
    botKey,
    registeredAt: BigInt(registeredAt),
    revokedAt: BigInt(revokedAt),
    active: registeredAt > 0n && revokedAt === 0n,
  };
}

/**
 * Find operators currently owned by address (minted or transferred).
 * @param {import('viem').PublicClient} pub
 * @param {{ registry: string, owner: `0x${string}`, fromBlock?: bigint, chunkBlocks?: bigint }} opts
 */
export async function findOperatorsByOwner(pub, opts) {
  const fromBlock = opts.fromBlock ?? 0n;
  const chunkBlocks = opts.chunkBlocks ?? LOG_CHUNK_BLOCKS;
  const registry = /** @type {`0x${string}`} */ (opts.registry);
  const owner = getAddress(opts.owner);

  const registeredLogs = await getLogsChunked(
    pub,
    {
      address: registry,
      event: OPERATOR_REGISTERED,
      args: { owner },
      fromBlock,
      toBlock: "latest",
    },
    { chunkBlocks },
  );

  const transferredLogs = await getLogsChunked(
    pub,
    {
      address: registry,
      event: OPERATOR_TRANSFERRED,
      args: { newOwner: owner },
      fromBlock,
      toBlock: "latest",
    },
    { chunkBlocks },
  );

  /** @type {Map<string, { label?: string, id: `0x${string}`, tx?: string }>} */
  const byId = new Map();

  for (const log of registeredLogs) {
    const id = log.args.id;
    const label = log.args.label;
    if (!id) continue;
    byId.set(id.toLowerCase(), {
      id,
      label: label ?? undefined,
      tx: log.transactionHash,
    });
  }

  for (const log of transferredLogs) {
    const id = log.args.id;
    if (!id) continue;
    const key = id.toLowerCase();
    if (!byId.has(key)) {
      byId.set(key, { id, tx: log.transactionHash });
    }
  }

  // Recover labels for transfer-only ids via OperatorRegistered filtered by id.
  for (const entry of byId.values()) {
    if (entry.label) continue;
    const labelLogs = await getLogsChunked(
      pub,
      {
        address: registry,
        event: OPERATOR_REGISTERED,
        args: { id: entry.id },
        fromBlock,
        toBlock: "latest",
      },
      { chunkBlocks },
    );
    const last = labelLogs[labelLogs.length - 1];
    if (last?.args?.label) {
      entry.label = last.args.label;
      entry.tx = entry.tx ?? last.transactionHash;
    }
  }

  const results = [];
  for (const entry of byId.values()) {
    if (!entry.label) continue;
    const [storageOwner, registeredAt, revokedAt] = await pub.readContract({
      address: registry,
      abi: clankerIdentityAbi,
      functionName: "operators",
      args: [entry.id],
    });
    if (getAddress(storageOwner) !== owner) continue;
    results.push({
      label: entry.label,
      id: entry.id,
      owner: storageOwner,
      registeredAt: BigInt(registeredAt),
      revokedAt: BigInt(revokedAt),
      active: registeredAt > 0n && revokedAt === 0n,
      mintTx: entry.tx,
    });
  }
  return results;
}

/**
 * Find bots under an operator via BotRegistered logs + storage refresh.
 * @param {import('viem').PublicClient} pub
 * @param {{ registry: string, operatorId: `0x${string}`, fromBlock?: bigint, chunkBlocks?: bigint }} opts
 */
export async function findBotsByOperator(pub, opts) {
  const fromBlock = opts.fromBlock ?? 0n;
  const chunkBlocks = opts.chunkBlocks ?? LOG_CHUNK_BLOCKS;
  const registry = /** @type {`0x${string}`} */ (opts.registry);

  const logs = await getLogsChunked(
    pub,
    {
      address: registry,
      event: BOT_REGISTERED,
      args: { operatorId: opts.operatorId },
      fromBlock,
      toBlock: "latest",
    },
    { chunkBlocks },
  );

  const byLabel = new Map();
  for (const log of logs) {
    const label = log.args.label;
    const id = log.args.id;
    if (!label || !id) continue;
    byLabel.set(label, {
      label,
      id,
      botKeyAtMint: log.args.botKey,
      blockNumber: log.blockNumber,
      tx: log.transactionHash,
    });
  }

  const results = [];
  for (const entry of byLabel.values()) {
    const [operatorId, botKey, registeredAt, revokedAt] = await pub.readContract({
      address: registry,
      abi: clankerIdentityAbi,
      functionName: "bots",
      args: [entry.id],
    });
    results.push({
      label: entry.label,
      id: entry.id,
      operatorId,
      botKey,
      registeredAt: BigInt(registeredAt),
      revokedAt: BigInt(revokedAt),
      active: registeredAt > 0n && revokedAt === 0n,
      mintTx: entry.tx,
    });
  }
  return results;
}

/**
 * Pure helper: pick a single operator label when profile/flag/list interact.
 * Preferred labels must be active when present in the list.
 *
 * @param {{ operators: Array<{label: string, active: boolean}>, preferred?: string|null }} opts
 * @returns {{ label: string } | { error: string, candidates: string[] }}
 */
export function pickOperatorLabel(opts) {
  const active = opts.operators.filter((o) => o.active);
  if (opts.preferred) {
    const hit = opts.operators.find((o) => o.label === opts.preferred);
    if (!hit) {
      return {
        error: `Operator "${opts.preferred}" not found for this owner`,
        candidates: opts.operators.map((o) => o.label),
      };
    }
    if (!hit.active) {
      return {
        error: `Operator "${opts.preferred}" is revoked`,
        candidates: active.map((o) => o.label),
      };
    }
    return { label: hit.label };
  }
  if (active.length === 1) return { label: active[0].label };
  if (active.length === 0) {
    return {
      error: "No active operators for this address. Mint one with `clanker operator mint <label>`.",
      candidates: [],
    };
  }
  return {
    error:
      "Multiple operators for this address; pass --operator <label> or set ~/.clanker/operator.json",
    candidates: active.map((o) => o.label),
  };
}
