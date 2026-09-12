import { keccak256, toBytes, type Address, type Hex } from "viem";
import {
  ALCHEMY_BASE_SEPOLIA_FAUCET_URL,
  BASE_SEPOLIA_FAUCET_URL,
  BROKER_URL,
  CHAIN_RPC_URL,
  MQTT_AUTH_SERVICE_URL,
  SEPOLIA_REGISTRY,
} from "./constants";

export function labelToId(label: string): Hex {
  return keccak256(toBytes(label));
}

export function assertSafeBotLabel(label: string): void {
  const s = String(label ?? "");
  if (!s) throw new Error("Name this computer with a short label (no spaces).");
  if (s.includes("\0")) throw new Error("Label must not contain NUL");
  if (s.includes("/") || s.includes("\\")) {
    throw new Error("Label must not contain path separators");
  }
  if (s === "." || s === ".." || s.includes("..")) {
    throw new Error('Label must not contain ".."');
  }
  if (/\s/.test(s)) {
    throw new Error("Use dots instead of spaces (example: you.laptop)");
  }
}

export function assertOperatorLabel(label: string): void {
  const s = String(label ?? "").trim();
  if (!s) throw new Error("Pick a name for your operator");
  if (s.includes("\0") || s.includes("/") || s.includes("\\")) {
    throw new Error("Name must not contain path separators");
  }
  if (/\s/.test(s)) {
    throw new Error("Use dots instead of spaces (example: org.you)");
  }
}

export function harnessSnippet(opts: {
  botId: string;
  operatorId: string;
}): Record<string, unknown> {
  return {
    enabled: true,
    botId: opts.botId,
    operatorId: opts.operatorId,
    brokerUrl: BROKER_URL,
    chainRpcUrl: CHAIN_RPC_URL,
    registryAddress: SEPOLIA_REGISTRY,
    mqttAuthServiceUrl: MQTT_AUTH_SERVICE_URL,
    privateKeyFile: `~/.openclaw/keys/${opts.botId}.key`,
  };
}

export function downloadTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function shortenAddress(addr: Address | string): string {
  const s = String(addr);
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export { BASE_SEPOLIA_FAUCET_URL, ALCHEMY_BASE_SEPOLIA_FAUCET_URL };
