import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";

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

export function assertCanonicalBotId(to: string): void {
  if (!to.includes(".")) {
    throw new Error(
      `mqtt_send: "to" must be a canonical bot id (e.g. openclaw.tooter.prod-1), not a display name like "${to}". ` +
        "Peers subscribe on bots/{canonicalBotId}/inbox.",
    );
  }
}
