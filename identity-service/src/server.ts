import { EvmBackend } from "./backend-evm";
import type { IdentityBackend } from "./backend";
import { getDefaultLedgerPath } from "./ledger";
import { createFetchHandler } from "./routes";
import type { Hex } from "viem";

function requiredEnv(name: string): string {
  const v = process.env[name] ?? Bun.env[name];
  if (!v || v === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function createBackend(): IdentityBackend {
  const snapshotPath =
    (process.env.IDENTITY_LEDGER_PATH ?? Bun.env.IDENTITY_LEDGER_PATH) ?? getDefaultLedgerPath();
  const rpcUrl = requiredEnv("CHAIN_RPC_URL");
  const registry = requiredEnv("REGISTRY_ADDRESS") as Hex;
  return new EvmBackend({
    rpcUrl,
    registry,
    deploymentBlock: BigInt(
      process.env.DEPLOYMENT_BLOCK ?? Bun.env.DEPLOYMENT_BLOCK ?? "0",
    ),
    snapshotPath,
    pollMs: Number(process.env.EVM_POLL_MS ?? Bun.env.EVM_POLL_MS ?? "3000"),
    logChunkBlocks: BigInt(
      process.env.EVM_LOG_CHUNK_BLOCKS ?? Bun.env.EVM_LOG_CHUNK_BLOCKS ?? "2000",
    ),
  });
}

async function main() {
  const backend = createBackend();
  await backend.start?.();

  const server = Bun.serve({
    port: Bun.env.IDENTITY_SERVICE_PORT ? Number(Bun.env.IDENTITY_SERVICE_PORT) : 8080,
    fetch: createFetchHandler(backend),
  });

  const shutdown = async (signal: string) => {
    console.log(`Identity service shutting down (${signal})…`);
    await backend.stop?.();
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  console.log(
    `Identity service listening on port ${
      Bun.env.IDENTITY_SERVICE_PORT ? Number(Bun.env.IDENTITY_SERVICE_PORT) : 8080
    }`,
  );
}

main().catch((err) => {
  console.error("Identity service failed to start:", err);
  process.exit(1);
});
