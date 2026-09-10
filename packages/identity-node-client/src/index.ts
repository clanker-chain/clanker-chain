import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { type Address, type Hex, type PrivateKeyAccount, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  type ClankerEip712Domain,
  signEnvelope,
  verifyEnvelope,
  CLANKER_MESSAGE_SIGNATURE_SCHEME,
} from "./eip712.js";
import {
  onchainBotToRecord,
  RegistryClient,
  type OnchainBot,
  type OnchainOperator,
} from "./registry-client.js";
import type { BotRecord, IdentityMessageEnvelope } from "./types.js";

// Re-export reader types used by mqtt-auth and tests.
export type { OnchainBot, OnchainOperator } from "./registry-client.js";
export {
  RegistryClient,
  onchainBotToRecord,
  onchainOperatorToRecord,
  registryLabelToId,
} from "./registry-client.js";

function isHexEthPrivateKey(raw: string): boolean {
  const s = raw.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}

function labelToId(label: string): Hex {
  return keccak256(toBytes(label)) as Hex;
}

/** @deprecated Prefer IdentityRegistryReader from registry-client. */
export type IdentityBackendHealth = {
  ok: boolean;
  mode: "evm";
  chainId?: number;
  registryAddress?: string;
  lastBlock?: string;
  chainOk?: boolean;
  error?: string;
};

export interface IdentityClientOptions {
  botId: string;
  operatorId: string;
  /** Base Sepolia / Anvil RPC URL (or set CHAIN_RPC_URL). */
  chainRpcUrl?: string;
  /** ClankerIdentity address (or set REGISTRY_ADDRESS). */
  registryAddress?: Address;
  /** Optional pinned chain id. */
  chainId?: number;
  mqttAuthServiceUrl?: string;
  keyPath?: string;
  ethPrivateKey?: Hex;
  /** Override EIP-712 domain (skips RPC chainId read for domain). */
  eip712Domain?: ClankerEip712Domain;
  /** Test injection / custom reader. */
  registry?: IdentityRegistryReader;
  cacheTtlMs?: number;
}

/** Minimal reader surface IdentityClient needs (RegistryClient implements this). */
export interface IdentityRegistryReader {
  getBotByLabel(label: string): Promise<OnchainBot | null>;
  getOperatorByLabel(label: string): Promise<OnchainOperator | null>;
  getOperatorById(operatorId: Hex): Promise<OnchainOperator | null>;
  getEip712Domain(): Promise<ClankerEip712Domain>;
  clearCache?(): void;
}

export class IdentityClient {
  private readonly botId: string;
  private readonly operatorId: string;
  private readonly mqttAuthBaseUrl: string;
  private readonly keyPath: string;
  private readonly ethPrivateKeyOverride?: Hex;
  private readonly eip712DomainOverride?: ClankerEip712Domain;
  private readonly registry: IdentityRegistryReader;
  private eip712Domain?: ClankerEip712Domain;

  constructor(options: IdentityClientOptions) {
    this.botId = options.botId;
    this.operatorId = options.operatorId;
    this.mqttAuthBaseUrl =
      options.mqttAuthServiceUrl ?? process.env.MQTT_AUTH_SERVICE_URL ?? "http://localhost:9090";
    const defaultKeyPath = path.join(os.homedir(), ".openclaw", "keys", `${this.botId}.key`);
    this.keyPath = options.keyPath ?? defaultKeyPath;
    this.ethPrivateKeyOverride =
      options.ethPrivateKey ?? (process.env.BOT_ETH_PRIVATE_KEY as Hex | undefined);
    this.eip712DomainOverride = options.eip712Domain;

    if (options.registry) {
      this.registry = options.registry;
    } else {
      const rpcUrl =
        options.chainRpcUrl ?? process.env.CHAIN_RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL;
      const registryAddress = (options.registryAddress ??
        process.env.REGISTRY_ADDRESS) as Address | undefined;
      if (!rpcUrl || !registryAddress || !/^0x[0-9a-fA-F]{40}$/.test(registryAddress)) {
        throw new Error(
          "IdentityClient requires chainRpcUrl + registryAddress (or CHAIN_RPC_URL + REGISTRY_ADDRESS; registry must be 0x + 40 hex)",
        );
      }
      this.registry = new RegistryClient({
        rpcUrl,
        registryAddress,
        chainId: options.chainId,
        cacheTtlMs: options.cacheTtlMs,
      });
    }
  }

  private async readKeyFile(): Promise<string> {
    return (await fs.readFile(this.keyPath, "utf8")).trim();
  }

  private async loadEthAccount(): Promise<PrivateKeyAccount> {
    const fromOpt = this.ethPrivateKeyOverride ?? (process.env.BOT_ETH_PRIVATE_KEY as Hex | undefined);
    if (fromOpt) {
      return privateKeyToAccount(fromOpt);
    }
    const raw = await this.readKeyFile();
    if (!isHexEthPrivateKey(raw)) {
      throw new Error(
        `expected secp256k1-eth private key at ${this.keyPath} (0x + 64 hex chars) or set BOT_ETH_PRIVATE_KEY`,
      );
    }
    return privateKeyToAccount(raw as Hex);
  }

  getActiveEthPublicKey(bot: BotRecord): string | undefined {
    return bot.public_keys?.find((k) => k.algorithm === "secp256k1-eth" && k.status === "active")
      ?.public_key;
  }

  private async fetchAndValidateEip712Domain(): Promise<ClankerEip712Domain> {
    if (this.eip712DomainOverride) {
      this.eip712Domain = this.eip712DomainOverride;
      return this.eip712DomainOverride;
    }
    this.eip712Domain = await this.registry.getEip712Domain();
    return this.eip712Domain;
  }

  private getEip712Domain(): ClankerEip712Domain {
    if (this.eip712DomainOverride) {
      return this.eip712DomainOverride;
    }
    if (!this.eip712Domain) {
      throw new Error("Identity client not initialized; call init() first");
    }
    return this.eip712Domain;
  }

  async init(): Promise<void> {
    await this.fetchAndValidateEip712Domain();

    const operator = await this.registry.getOperatorByLabel(this.operatorId);
    if (!operator) {
      throw new Error(
        "Operator not registered. Register the operator on-chain first (clanker chain mint-operator).",
      );
    }
    if (operator.status !== "active") {
      throw new Error(`Operator status is ${operator.status}; expected active`);
    }

    const bot = await this.registry.getBotByLabel(this.botId);
    if (!bot) {
      throw new Error(
        "Bot not registered; operator must register this bot on-chain with your botKey address.",
      );
    }
    if (bot.status !== "active") {
      throw new Error(`Bot status is ${bot.status}; expected active`);
    }

    const expectedOpId = labelToId(this.operatorId);
    if (bot.operatorId.toLowerCase() !== expectedOpId.toLowerCase()) {
      throw new Error(
        `Bot ${this.botId} is not owned by operator ${this.operatorId} on-chain`,
      );
    }

    const onchainKey = bot.botKey;
    if (!onchainKey || onchainKey === "0x0000000000000000000000000000000000000000") {
      throw new Error("Bot has no active secp256k1-eth key");
    }

    const account = await this.loadEthAccount();
    if (account.address.toLowerCase() !== onchainKey.toLowerCase()) {
      throw new Error(
        `local secp256k1 key address ${account.address} does not match ledger botKey ${onchainKey}`,
      );
    }
  }

  async getBot(): Promise<BotRecord> {
    const bot = await this.registry.getBotByLabel(this.botId);
    if (!bot) {
      throw new Error(`Bot not found on-chain: ${this.botId}`);
    }
    return onchainBotToRecord(bot, this.operatorId);
  }

  async signMessage(msg: IdentityMessageEnvelope): Promise<{
    signature: Hex;
    signature_scheme: typeof CLANKER_MESSAGE_SIGNATURE_SCHEME;
  }> {
    const domain = this.getEip712Domain();
    const account = await this.loadEthAccount();
    return signEnvelope(account, msg, domain);
  }

  async verifyMessage(
    msg: IdentityMessageEnvelope,
    signature: Hex,
    fromBotId: string,
  ): Promise<boolean> {
    const domain = this.getEip712Domain();
    const bot = await this.registry.getBotByLabel(fromBotId);
    if (!bot || bot.status !== "active") {
      return false;
    }
    const operator = await this.registry.getOperatorById(bot.operatorId);
    if (!operator || operator.status !== "active") {
      return false;
    }
    if (!bot.botKey || bot.botKey === "0x0000000000000000000000000000000000000000") {
      return false;
    }
    // Facts hygiene: envelope.operator_id must match the on-chain operator of from_id.
    const claimedOp = String(msg.operator_id ?? "").trim();
    if (!claimedOp || labelToId(claimedOp).toLowerCase() !== bot.operatorId.toLowerCase()) {
      return false;
    }
    return verifyEnvelope(msg, signature, bot.botKey, domain);
  }

  async issueMqttConnectPassword(): Promise<string> {
    return this.issueMqttSiwePassword();
  }

  async issueMqttSiwePassword(): Promise<string> {
    const bot = await this.registry.getBotByLabel(this.botId);
    if (!bot || bot.status !== "active") {
      throw new Error("Bot has no active on-chain registration");
    }
    if (!bot.botKey || bot.botKey === "0x0000000000000000000000000000000000000000") {
      throw new Error("Bot has no active secp256k1-eth key");
    }

    const account = await this.loadEthAccount();
    if (account.address.toLowerCase() !== bot.botKey.toLowerCase()) {
      throw new Error(
        `local secp256k1 key address ${account.address} does not match ledger botKey ${bot.botKey}`,
      );
    }

    const url = new URL("/nonce", this.mqttAuthBaseUrl);
    url.searchParams.set("bot_id", this.botId);
    const res = await fetch(url.toString(), { method: "GET" });
    const text = await res.text();
    let parsed: { nonce?: string; message?: string };
    try {
      parsed = JSON.parse(text) as { nonce?: string; message?: string };
    } catch {
      throw new Error(`Unexpected nonce response: ${text}`);
    }
    if (!res.ok || !parsed.nonce || !parsed.message) {
      throw new Error(
        (parsed as { message?: string }).message || `nonce request failed: HTTP ${res.status}`,
      );
    }

    const sig = await account.signMessage({ message: parsed.message });
    return `${parsed.nonce}.${sig}`;
  }
}

export * from "./types.js";
export * from "./eip712.js";
