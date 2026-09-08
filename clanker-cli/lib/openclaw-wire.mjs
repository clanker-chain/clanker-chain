/**
 * Merge / create ~/.openclaw/openclaw.json channels.mqtt from clanker profile.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { harnessSnippet } from "./profile.mjs";

/** Current published OpenClaw plugin pins for closed-beta invite. */
export const OPENCLAW_PLUGIN_PIN = "2026.7.29";

/**
 * @param {string} [openclawHome]
 */
export function openclawConfigPath(openclawHome = join(homedir(), ".openclaw")) {
  return join(openclawHome, "openclaw.json");
}

/**
 * Ensure mqtt + mqtt-tools are in plugins.enabled.
 * @param {object} cfg
 */
export function ensureMqttPlugins(cfg) {
  const out = { ...cfg };
  const plugins = { ...(out.plugins ?? {}) };
  const enabled = Array.isArray(plugins.enabled) ? [...plugins.enabled] : [];
  for (const id of ["mqtt", "mqtt-tools"]) {
    if (!enabled.includes(id)) enabled.push(id);
  }
  plugins.enabled = enabled;
  out.plugins = plugins;
  return out;
}

/**
 * Wire channels.mqtt into openclaw.json.
 *
 * @param {{
 *   botId: string,
 *   operatorId: string,
 *   network: { rpc: string, registry: string|null, brokerUrl?: string, mqttAuthServiceUrl?: string },
 *   keyPath?: string|null,
 *   openclawHome?: string,
 * }} opts
 */
export function wireOpenClawMqtt(opts) {
  const openclawHome = opts.openclawHome ?? join(homedir(), ".openclaw");
  const cfgPath = openclawConfigPath(openclawHome);
  mkdirSync(openclawHome, { recursive: true });

  const mqtt = harnessSnippet({
    botId: opts.botId,
    operatorId: opts.operatorId,
    network: opts.network,
  });
  if (!mqtt.registryAddress) {
    mqtt.registryAddress = "0x0000000000000000000000000000000000000000";
  }
  if (opts.keyPath) {
    mqtt.privateKeyFile = opts.keyPath;
  }

  let created = false;
  let cfg;
  if (!existsSync(cfgPath)) {
    created = true;
    cfg = {
      plugins: { enabled: ["mqtt", "mqtt-tools"] },
      channels: { mqtt },
    };
  } else {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg = ensureMqttPlugins(cfg);
    const channels = { ...(cfg.channels ?? {}) };
    const prev = channels.mqtt && typeof channels.mqtt === "object" ? channels.mqtt : {};
    channels.mqtt = { ...prev, ...mqtt };
    cfg.channels = channels;
  }

  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  return {
    created,
    path: cfgPath,
    channelsMqtt: cfg.channels.mqtt,
    pluginPin: OPENCLAW_PLUGIN_PIN,
  };
}

/**
 * Human checklist lines after wiring.
 * @param {{ botId: string, channelsMqtt: object, pluginPin: string }} opts
 */
export function hubConnectChecklist(opts) {
  const pin = opts.pluginPin ?? OPENCLAW_PLUGIN_PIN;
  return [
    "Your bot login is already wired — install plugins and restart OpenClaw.",
    `openclaw plugins install @clanker-chain/mqtt-channel-plugin@${pin}`,
    `openclaw plugins install @clanker-chain/mqtt-tools@${pin}`,
    "Enable plugin ids mqtt + mqtt-tools (already set in openclaw.json if we wired it)",
    `CONNECT broker: ${opts.channelsMqtt?.brokerUrl ?? "mqtts://mqtt.clanker-chain.com:8883"}`,
    `Ask hub operator to allow bot_id "${opts.botId}" in france dmPolicy / allowFrom`,
    "DM openclaw.france.prod-1 to smoke the mesh",
  ];
}

/**
 * Plain-language card: what the bot uses vs operator mint key.
 * @param {{
 *   botId: string,
 *   operatorId: string,
 *   keyPath: string,
 *   openclawPath: string,
 *   created?: boolean,
 * }} opts
 * @returns {string[]}
 */
export function botIdentityCard(opts) {
  const openclawState = opts.created
    ? `${opts.openclawPath} (channels.mqtt created)`
    : `${opts.openclawPath} (channels.mqtt updated)`;
  return [
    "Bot identity (what OpenClaw uses to CONNECT):",
    `bot id:     ${opts.botId}`,
    `operator:   ${opts.operatorId}`,
    `bot key:    ${opts.keyPath}`,
    `openclaw:   ${openclawState}`,
    "Do not give the bot ~/.clanker/op.key — that key is only for mint/transfer.",
  ];
}

/**
 * Structured bot_identity for --json mint output.
 * @param {{ botId: string, keyPath: string, openclawConfigPath: string }} opts
 */
export function botIdentityJson(opts) {
  return {
    botId: opts.botId,
    keyPath: opts.keyPath,
    openclawConfigPath: opts.openclawConfigPath,
    warnOperatorKey:
      "Do not give the bot ~/.clanker/op.key — that key is only for mint/transfer.",
  };
}

