import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import type { MqttChannelConfig } from './types.js';

export type ResolvedMqttAccount = {
  accountId: string;
  /** True when required MQTT + chain identity fields are present */
  configured: boolean;
  /** `channels.mqtt` / per-account `enabled` flags (default true when omitted) */
  userEnabled: boolean;
  botId: string;
  operatorId: string;
  brokerUrl: string;
  chainRpcUrl: string;
  registryAddress: string;
  mqttAuthServiceUrl?: string;
  dmPolicy?: string | null;
  allowFrom?: Array<string | number> | null;
  allowOperators?: string[] | null;
  topics?: MqttChannelConfig['topics'];
  pollIntervalMs?: number;
};

type MqttSection = Record<string, unknown>;

/** Same bar as mqtt-auth / IdentityClient: 0x + 40 hex. */
const REGISTRY_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function isValidRegistryAddress(value: string): boolean {
  return REGISTRY_ADDRESS_PATTERN.test(value);
}

function getMqttSection(cfg: OpenClawConfig): MqttSection | undefined {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const mqtt = channels?.mqtt;
  if (!mqtt || typeof mqtt !== 'object' || Array.isArray(mqtt)) {
    return undefined;
  }
  return mqtt as MqttSection;
}

function readAccountSlice(section: MqttSection, accountId: string): MqttSection | undefined {
  const accounts = section.accounts;
  if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
    const slice = (accounts as Record<string, MqttSection>)[accountId];
    return slice && typeof slice === 'object' ? slice : undefined;
  }
  if (accountId === 'default') {
    return section;
  }
  return undefined;
}

function readString(obj: MqttSection | undefined, key: string): string {
  const v = obj?.[key];
  return typeof v === 'string' ? v : '';
}

function readOptionalString(obj: MqttSection | undefined, key: string): string | undefined {
  const v = obj?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function readBoolean(obj: MqttSection | undefined, key: string, defaultValue: boolean): boolean {
  const v = obj?.[key];
  if (typeof v === 'boolean') {
    return v;
  }
  return defaultValue;
}

function readAllowFrom(obj: MqttSection | undefined): Array<string | number> | null | undefined {
  const v = obj?.allowFrom;
  if (!Array.isArray(v)) {
    return undefined;
  }
  return v.filter((x) => typeof x === 'string' || typeof x === 'number') as Array<string | number>;
}

function readAllowOperators(obj: MqttSection | undefined): string[] | null | undefined {
  const v = obj?.allowOperators;
  if (!Array.isArray(v)) {
    return undefined;
  }
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

export function listMqttAccountIds(cfg: OpenClawConfig): string[] {
  const section = getMqttSection(cfg);
  if (!section) {
    return [];
  }
  const accounts = section.accounts;
  if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
    return Object.keys(accounts as Record<string, unknown>);
  }
  return ['default'];
}

export function resolveMqttAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedMqttAccount {
  const id = accountId?.trim() ? accountId.trim() : 'default';
  const section = getMqttSection(cfg);
  if (!section) {
    return {
      accountId: id,
      configured: false,
      userEnabled: false,
      botId: '',
      operatorId: '',
      brokerUrl: '',
      chainRpcUrl: '',
      registryAddress: '',
    };
  }

  const slice = readAccountSlice(section, id);
  const topEnabled = readBoolean(section, 'enabled', true);
  const sliceEnabled = slice ? readBoolean(slice, 'enabled', true) : false;

  const botId = readString(slice, 'botId');
  const operatorId = readString(slice, 'operatorId');
  const brokerUrl = readString(slice, 'brokerUrl');
  const chainRpcUrl =
    readString(slice, 'chainRpcUrl') || readString(section, 'chainRpcUrl');
  const registryAddress =
    readString(slice, 'registryAddress') || readString(section, 'registryAddress');
  const mqttAuthServiceUrl =
    readOptionalString(slice, 'mqttAuthServiceUrl') ??
    readOptionalString(section, 'mqttAuthServiceUrl');
  const dmPolicy = readOptionalString(slice, 'dmPolicy') ?? readOptionalString(section, 'dmPolicy');
  const allowFrom = readAllowFrom(slice) ?? readAllowFrom(section);
  const allowOperators = readAllowOperators(slice) ?? readAllowOperators(section);

  const topicsRaw = slice?.topics;
  let topics: MqttChannelConfig['topics'] | undefined;
  if (topicsRaw && typeof topicsRaw === 'object' && !Array.isArray(topicsRaw)) {
    const t = topicsRaw as Record<string, unknown>;
    topics = {
      inbox: typeof t.inbox === 'string' ? t.inbox : undefined,
      announce: typeof t.announce === 'string' ? t.announce : undefined,
      status: typeof t.status === 'string' ? t.status : undefined,
    };
  }

  const pollRaw = slice?.pollIntervalMs;
  const pollIntervalMs = typeof pollRaw === 'number' && Number.isFinite(pollRaw) ? pollRaw : undefined;

  const configured = Boolean(
    botId &&
      operatorId &&
      brokerUrl &&
      chainRpcUrl &&
      isValidRegistryAddress(registryAddress),
  );
  const userEnabled = topEnabled && sliceEnabled;

  return {
    accountId: id,
    configured,
    userEnabled,
    botId,
    operatorId,
    brokerUrl,
    chainRpcUrl,
    registryAddress,
    mqttAuthServiceUrl,
    dmPolicy: dmPolicy ?? null,
    allowFrom: allowFrom ?? null,
    allowOperators: allowOperators ?? null,
    topics,
    pollIntervalMs,
  };
}

export function isMqttAccountConfigured(account: ResolvedMqttAccount): boolean {
  return Boolean(
    account.botId &&
      account.operatorId &&
      account.brokerUrl &&
      account.chainRpcUrl &&
      isValidRegistryAddress(account.registryAddress),
  );
}

export function mqttAccountToChannelConfig(account: ResolvedMqttAccount): MqttChannelConfig {
  return {
    botId: account.botId,
    operatorId: account.operatorId,
    brokerUrl: account.brokerUrl,
    chainRpcUrl: account.chainRpcUrl,
    registryAddress: account.registryAddress,
    mqttAuthServiceUrl: account.mqttAuthServiceUrl,
    topics: account.topics,
    pollIntervalMs: account.pollIntervalMs,
  };
}
