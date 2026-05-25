import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";
import type { ToolExecuteContext } from "openclaw/plugin-sdk/tool-plugin";

export type ResolvedMqttToolsConfig = {
  accountId: string;
  configured: boolean;
  userEnabled: boolean;
  botId: string;
  operatorId: string;
  brokerUrl: string;
  identityServiceUrl: string;
  mqttAuthServiceUrl: string;
};

/** Safe MQTT topic segment: lowercase id with dots/hyphens, no path/MQTT wildcards. */
export const CANONICAL_BOT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
export const MAX_BOT_ID_LENGTH = 128;
export const MAX_MESSAGE_TEXT_BYTES = 32 * 1024;
export const MAX_REPLY_TO_LENGTH = 256;

type MqttSection = Record<string, unknown>;

function getMqttSection(cfg: OpenClawConfig): MqttSection | undefined {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const mqtt = channels?.mqtt;
  if (!mqtt || typeof mqtt !== "object" || Array.isArray(mqtt)) {
    return undefined;
  }
  return mqtt as MqttSection;
}

function readAccountSlice(section: MqttSection, accountId: string): MqttSection | undefined {
  const accounts = section.accounts;
  if (accounts && typeof accounts === "object" && !Array.isArray(accounts)) {
    const slice = (accounts as Record<string, MqttSection>)[accountId];
    return slice && typeof slice === "object" ? slice : undefined;
  }
  if (accountId === "default") {
    return section;
  }
  return undefined;
}

function readString(obj: MqttSection | undefined, key: string): string {
  const v = obj?.[key];
  return typeof v === "string" ? v : "";
}

function readBoolean(obj: MqttSection | undefined, key: string, defaultValue: boolean): boolean {
  const v = obj?.[key];
  if (typeof v === "boolean") {
    return v;
  }
  return defaultValue;
}

export function resolveMqttToolsConfig(
  cfg: OpenClawConfig,
  accountId = "default",
): ResolvedMqttToolsConfig {
  const id = accountId.trim() || "default";
  const section = getMqttSection(cfg);
  if (!section) {
    return {
      accountId: id,
      configured: false,
      userEnabled: false,
      botId: "",
      operatorId: "",
      brokerUrl: "",
      identityServiceUrl: "",
      mqttAuthServiceUrl: "http://localhost:9090",
    };
  }

  const slice = readAccountSlice(section, id);
  const topEnabled = readBoolean(section, "enabled", true);
  const sliceEnabled = slice ? readBoolean(slice, "enabled", true) : false;

  const botId = readString(slice, "botId");
  const operatorId = readString(slice, "operatorId");
  const brokerUrl = readString(slice, "brokerUrl");
  const identityServiceUrl = readString(slice, "identityServiceUrl");
  const mqttAuthServiceUrl =
    readString(slice, "mqttAuthServiceUrl") ||
    readString(section, "mqttAuthServiceUrl") ||
    "http://localhost:9090";

  const configured = Boolean(botId && operatorId && brokerUrl && identityServiceUrl);
  const userEnabled = topEnabled && sliceEnabled;

  return {
    accountId: id,
    configured,
    userEnabled,
    botId,
    operatorId,
    brokerUrl,
    identityServiceUrl,
    mqttAuthServiceUrl,
  };
}

/** Resolve MQTT account id from tool runtime context (matches channel per-account wiring). */
export function resolveToolAccountId(context: ToolExecuteContext): string {
  const toolContext = context.toolContext as Record<string, unknown> | undefined;
  const candidates = [toolContext?.accountId, toolContext?.channelAccountId, context.accountId];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "default";
}

export function validateRecipientBotId(to: string): void {
  if (!to.includes(".")) {
    throw new Error(
      `mqtt_send: "to" must be a canonical bot id (e.g. openclaw.tooter.prod-1), not a display name like "${to}". ` +
        "Peers subscribe on bots/{canonicalBotId}/inbox.",
    );
  }
  if (to.length > MAX_BOT_ID_LENGTH) {
    throw new Error(`mqtt_send: "to" exceeds maximum length (${MAX_BOT_ID_LENGTH}).`);
  }
  if (to.includes("..") || to.startsWith(".") || to.endsWith(".")) {
    throw new Error(`mqtt_send: "to" has invalid dot placement: "${to}".`);
  }
  if (!CANONICAL_BOT_ID_PATTERN.test(to)) {
    throw new Error(
      `mqtt_send: "to" contains invalid characters (use lowercase letters, digits, dots, hyphens only): "${to}".`,
    );
  }
}

export function validateMessageFields(text: string, replyTo?: string): void {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_MESSAGE_TEXT_BYTES) {
    throw new Error(
      `mqtt_send: "text" exceeds maximum size (${MAX_MESSAGE_TEXT_BYTES} bytes, got ${bytes}).`,
    );
  }
  if (replyTo !== undefined && replyTo.length > MAX_REPLY_TO_LENGTH) {
    throw new Error(
      `mqtt_send: "replyTo" exceeds maximum length (${MAX_REPLY_TO_LENGTH}).`,
    );
  }
}

/** @deprecated Use validateRecipientBotId */
export const assertCanonicalBotId = validateRecipientBotId;
