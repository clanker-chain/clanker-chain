import { createPublicClient, http, type PublicClient } from "viem";

export function createIdentityPublicClient(rpcUrl: string): PublicClient {
  return createPublicClient({
    transport: http(rpcUrl, { timeout: 30_000 }),
  });
}

/** First block to index logs from (inclusive). */
export function getDeploymentBlock(env: NodeJS.ProcessEnv = process.env): bigint {
  return BigInt(env.DEPLOYMENT_BLOCK ?? "0");
}
