export type PublicKeyStatus = "active" | "revoked";

export interface PublicKeyRecord {
  key_id: string;
  algorithm: string;
  public_key: string;
  created: string;
  status: PublicKeyStatus;
  metadata?: Record<string, unknown>;
}

export interface OperatorRecord {
  operator_id: string;
  display_name?: string;
  public_keys?: PublicKeyRecord[];
  status: "active" | "suspended" | "retired";
  created: string;
  updated: string;
  metadata?: Record<string, unknown>;
}

export interface BotRecord {
  bot_id: string;
  display_name?: string;
  operator_id: string;
  aliases?: string[];
  public_keys?: PublicKeyRecord[];
  status: "active" | "suspended" | "retired";
  created: string;
  updated: string;
  metadata?: Record<string, unknown>;
}

export interface IdentityMessageEnvelope {
  from: string;
  from_id: string;
  operator_id: string;
  to?: string;
  to_id?: string;
  type: string;
  subtype?: string;
  channel?: string;
  timestamp: string;
  message_id: string;
  correlation_id?: string;
  privacy?: "default" | "private" | "encrypted";
  encrypted?: boolean;
  encryption_scheme?: string | null;
  identity_token?: string | null;
  body: unknown;
}

