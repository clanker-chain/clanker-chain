import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as ed25519 from "@noble/ed25519";
import type { BotRecord, IdentityMessageEnvelope, OperatorRecord, PublicKeyRecord } from "./types.js";

export interface IdentityClientOptions {
  botId: string;
  operatorId: string;
  /**
   * Base URL of the identity service, e.g. "http://localhost:8080".
   * Defaults to process.env.IDENTITY_SERVICE_URL or http://localhost:8080.
   */
  identityServiceUrl?: string;
  /**
   * Path to the private key file. Defaults to ~/.openclaw/keys/{botId}.key
   */
  keyPath?: string;
  /**
   * Admin token for write calls if required by the service.
   * Defaults to process.env.IDENTITY_ADMIN_TOKEN.
   */
  adminToken?: string;
}

export class IdentityClient {
  private readonly botId: string;
  private readonly operatorId: string;
  private readonly baseUrl: string;
  private readonly keyPath: string;
  private readonly adminToken?: string;

  constructor(options: IdentityClientOptions) {
    this.botId = options.botId;
    this.operatorId = options.operatorId;
    this.baseUrl = options.identityServiceUrl ?? process.env.IDENTITY_SERVICE_URL ?? "http://localhost:8080";
    const defaultKeyPath = path.join(os.homedir(), ".openclaw", "keys", `${this.botId}.key`);
    this.keyPath = options.keyPath ?? defaultKeyPath;
    this.adminToken = options.adminToken ?? process.env.IDENTITY_ADMIN_TOKEN;
  }

  /**
   * Ensure a private key exists on disk, returning the 32-byte private key.
   */
  private async loadOrCreatePrivateKey(): Promise<Uint8Array> {
    try {
      const raw = await fs.readFile(this.keyPath, "utf8");
      const bytes = Buffer.from(raw.trim(), "base64");
      if (bytes.length !== 32) {
        throw new Error("invalid key length");
      }
      return new Uint8Array(bytes);
    } catch {
      await fs.mkdir(path.dirname(this.keyPath), { recursive: true });
      const priv = ed25519.utils.randomPrivateKey();
      const b64 = Buffer.from(priv).toString("base64");
      await fs.writeFile(this.keyPath, `${b64}\n`, { encoding: "utf8", mode: 0o600 });
      return priv;
    }
  }

  /**
   * Derive the base64-encoded public key from the local private key.
   */
  async getPublicKeyBase64(): Promise<string> {
    const priv = await this.loadOrCreatePrivateKey();
    const pub = await ed25519.getPublicKeyAsync(priv);
    return Buffer.from(pub).toString("base64");
  }

  private authHeaders(): HeadersInit {
    const headers: HeadersInit = { "content-type": "application/json" };
    if (this.adminToken) {
      headers["authorization"] = `Bearer ${this.adminToken}`;
    }
    return headers;
  }

  private async postJson<T>(pathName: string, body: unknown, requireAuth = false): Promise<T> {
    const url = new URL(pathName, this.baseUrl).toString();
    const headers: HeadersInit = { "content-type": "application/json" };
    if (requireAuth && this.adminToken) {
      headers["authorization"] = `Bearer ${this.adminToken}`;
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
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

  /**
   * Verify that the operator and bot exist in the identity service and that
   * this instance's public key is registered on the bot. Does not create
   * operator or bot; they must be minted by the operator first.
   * Safe to call multiple times.
   */
  async init(): Promise<void> {
    try {
      await this.getJson<OperatorRecord>(
        `/v1/operators/${encodeURIComponent(this.operatorId)}`,
      );
    } catch {
      throw new Error(
        "Operator not registered. Operator must be minted first (genesis or mint-operator).",
      );
    }

    let bot: BotRecord;
    try {
      bot = await this.getJson<BotRecord>(
        `/v1/bots/${encodeURIComponent(this.botId)}`,
      );
    } catch {
      throw new Error(
        "Bot not registered or key not found; operator must mint this bot with your public key.",
      );
    }

    const publicKey = await this.getPublicKeyBase64();
    const hasKey =
      bot.public_keys?.some(
        (k) => k.public_key === publicKey && k.status === "active",
      ) ?? false;
    if (!hasKey) {
      throw new Error(
        "Bot not registered or key not found; operator must mint this bot with your public key.",
      );
    }
  }

  async getBot(): Promise<BotRecord> {
    return this.getJson<BotRecord>(`/v1/bots/${encodeURIComponent(this.botId)}`);
  }

  /**
   * Canonical JSON serialization used for signing, following bot-comms.md.
   */
  private static canonicalizeForSignature(msg: IdentityMessageEnvelope): string {
    const canonicalFields: Record<string, unknown> = {
      body: msg.body,
      correlation_id: msg.correlation_id,
      from: msg.from,
      from_id: msg.from_id,
      message_id: msg.message_id,
      operator_id: msg.operator_id,
      subtype: msg.subtype,
      timestamp: msg.timestamp,
      to: msg.to,
      to_id: msg.to_id,
      type: msg.type,
    };
    for (const key of Object.keys(canonicalFields)) {
      if (canonicalFields[key] === undefined || canonicalFields[key] === null) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete canonicalFields[key];
      }
    }
    const sortedKeys = Object.keys(canonicalFields).sort();
    return JSON.stringify(canonicalFields, sortedKeys as (keyof typeof canonicalFields)[]);
  }

  /**
   * Sign a message envelope using the local Ed25519 private key.
   * Returns base64(signature) and signature_scheme.
   */
  async signMessage(msg: IdentityMessageEnvelope): Promise<{
    signature: string;
    signature_scheme: "ed25519";
  }> {
    const priv = await this.loadOrCreatePrivateKey();
    const canonical = IdentityClient.canonicalizeForSignature(msg);
    const bytes = new TextEncoder().encode(canonical);
    const sig = await ed25519.signAsync(bytes, priv);
    return {
      signature: Buffer.from(sig).toString("base64"),
      signature_scheme: "ed25519",
    };
  }
}

export * from "./types.js";

