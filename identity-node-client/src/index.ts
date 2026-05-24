import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { type Address, type Hex, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  type ClankerEip712Domain,
  signEnvelope,
  verifyEnvelope,
  CLANKER_MESSAGE_SIGNATURE_SCHEME,
} from "./eip712.js";
import type { BotRecord, IdentityMessageEnvelope, OperatorRecord } from "./types.js";

function isHexEthPrivateKey(raw: string): boolean {
  const s = raw.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}

export interface IdentityBackendHealth {
  ok: boolean;
  mode: "evm";
  chainId?: number;
  registryAddress?: string;
  lastBlock?: string;
  chainOk?: boolean;
  error?: string;
}

export interface IdentityClientOptions {
  botId: string;
  operatorId: string;
  identityServiceUrl?: string;
  mqttAuthServiceUrl?: string;
  keyPath?: string;
  ethPrivateKey?: Hex;
  /** Override EIP-712 domain (defaults to values from GET /health during init). */
  eip712Domain?: ClankerEip712Domain;
}

export class IdentityClient {
  private readonly botId: string;
  private readonly operatorId: string;
  private readonly baseUrl: string;
  private readonly mqttAuthBaseUrl: string;
  private readonly keyPath: string;
  private readonly ethPrivateKeyOverride?: Hex;
  private readonly eip712DomainOverride?: ClankerEip712Domain;
  private eip712Domain?: ClankerEip712Domain;

  constructor(options: IdentityClientOptions) {
    this.botId = options.botId;
    this.operatorId = options.operatorId;
    this.baseUrl = options.identityServiceUrl ?? process.env.IDENTITY_SERVICE_URL ?? "http://localhost:8080";
    this.mqttAuthBaseUrl =
      options.mqttAuthServiceUrl ?? process.env.MQTT_AUTH_SERVICE_URL ?? "http://localhost:9090";
    const defaultKeyPath = path.join(os.homedir(), ".openclaw", "keys", `${this.botId}.key`);
    this.keyPath = options.keyPath ?? defaultKeyPath;
    this.ethPrivateKeyOverride =
      options.ethPrivateKey ?? (process.env.BOT_ETH_PRIVATE_KEY as Hex | undefined);
    this.eip712DomainOverride = options.eip712Domain;
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

  private async getJson<T>(pathName: string): Promise<T> {
    const url = new URL(pathName, this.baseUrl).toString();
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Unexpected response from identity service: ${text}`);
    }
    if (!res.ok) {
      const err = parsed as { error?: string; message?: string };
      throw new Error(err.message || err.error || `HTTP ${res.status}`);
    }
    return parsed as T;
  }

  private async fetchAndValidateEip712Domain(): Promise<ClankerEip712Domain> {
    if (this.eip712DomainOverride) {
      this.eip712Domain = this.eip712DomainOverride;
      return this.eip712DomainOverride;
    }
    const health = await this.getJson<IdentityBackendHealth>("/health");
    if (health.ok === false || health.chainOk === false) {
      throw new Error(
        "Identity service is degraded (chain indexer unreachable or stale); refusing init",
      );
    }
    if (
      health.chainId === undefined ||
      !health.registryAddress?.startsWith("0x")
    ) {
      throw new Error("identity service /health missing chainId or registryAddress for EIP-712");
    }
    this.eip712Domain = {
      chainId: health.chainId,
      registryAddress: health.registryAddress as Address,
    };
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

    try {
      const operator = await this.getJson<OperatorRecord>(
        `/v1/operators/${encodeURIComponent(this.operatorId)}`,
      );
      if (operator.status !== "active") {
        throw new Error(`Operator status is ${operator.status}; expected active`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Operator status")) {
        throw err;
      }
      throw new Error(
        "Operator not registered. Register the operator on-chain first (clanker chain mint-operator).",
      );
    }

    let bot: BotRecord;
    try {
      bot = await this.getJson<BotRecord>(
        `/v1/bots/${encodeURIComponent(this.botId)}`,
      );
    } catch {
      throw new Error(
        "Bot not registered; operator must register this bot on-chain with your botKey address.",
      );
    }

    if (bot.status !== "active") {
      throw new Error(`Bot status is ${bot.status}; expected active`);
    }

    const onchainKey = this.getActiveEthPublicKey(bot);
    if (!onchainKey?.startsWith("0x")) {
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
    return this.getJson<BotRecord>(`/v1/bots/${encodeURIComponent(this.botId)}`);
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
    let bot: BotRecord;
    try {
      bot = await this.getJson<BotRecord>(`/v1/bots/${encodeURIComponent(fromBotId)}`);
    } catch {
      return false;
    }
    if (bot.status !== "active") {
      return false;
    }
    if (bot.operator_id) {
      try {
        const operator = await this.getJson<OperatorRecord>(
          `/v1/operators/${encodeURIComponent(bot.operator_id)}`,
        );
        if (operator.status !== "active") {
          return false;
        }
      } catch {
        return false;
      }
    }
    const onchainKey = this.getActiveEthPublicKey(bot);
    if (!onchainKey?.startsWith("0x")) {
      return false;
    }
    return verifyEnvelope(msg, signature, onchainKey as Address, domain);
  }

  async issueMqttConnectPassword(): Promise<string> {
    return this.issueMqttSiwePassword();
  }

  async issueMqttSiwePassword(): Promise<string> {
    const bot = await this.getBot();
    const onchainKey = this.getActiveEthPublicKey(bot);
    if (!onchainKey?.startsWith("0x")) {
      throw new Error("Bot has no active secp256k1-eth key");
    }

    const account = await this.loadEthAccount();
    if (account.address.toLowerCase() !== onchainKey.toLowerCase()) {
      throw new Error(
        `local secp256k1 key address ${account.address} does not match ledger botKey ${onchainKey}`,
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
