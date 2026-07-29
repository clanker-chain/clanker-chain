/**
 * @deprecated Legacy Ed25519 / IDENTITY_SERVICE_URL client.
 * Use `@clanker-chain/identity-node-client` with CHAIN_RPC_URL + REGISTRY_ADDRESS.
 */

export type { BotRecord, IdentityMessageEnvelope, OperatorRecord, PublicKeyRecord } from "./types";

const DEPRECATION =
  "@clanker-chain/identity-plugin is deprecated (Ed25519 / IDENTITY_SERVICE_URL). " +
  "Use @clanker-chain/identity-node-client with CHAIN_RPC_URL + REGISTRY_ADDRESS. " +
  "See identity-client-plugin/DEPRECATED.md";

export interface IdentityClientOptions {
  botId: string;
  operatorId: string;
  /** @deprecated Legacy identity-service HTTP URL. */
  identityServiceUrl?: string;
  keyPath?: string;
}

/**
 * @deprecated Construction always throws. Import `@clanker-chain/identity-node-client` instead.
 */
export class IdentityClient {
  constructor(_options: IdentityClientOptions) {
    throw new Error(DEPRECATION);
  }
}

export function deprecatedIdentityPluginMessage(): string {
  return DEPRECATION;
}
