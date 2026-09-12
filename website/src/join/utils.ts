import { keccak256, toBytes, type Address, type Hex } from "viem";
import {
  ALCHEMY_BASE_SEPOLIA_FAUCET_URL,
  BASE_SEPOLIA_FAUCET_URL,
  BROKER_URL,
  CHAIN_RPC_URL,
  MQTT_AUTH_SERVICE_URL,
  SEPOLIA_REGISTRY,
} from "./constants";

/** Printable ASCII labels with dots — rejects Unicode lookalikes. */
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function labelToId(label: string): Hex {
  return keccak256(toBytes(label));
}

function assertSafeLabel(label: string, kind: "operator" | "bot"): void {
  const s = String(label ?? "").trim();
  const what =
    kind === "operator"
      ? "Pick a name for your operator"
      : "Name this computer with a short label (no spaces).";
  if (!s) throw new Error(what);
  if (s.includes("\0")) throw new Error("Label must not contain NUL");
  if (s.includes("/") || s.includes("\\")) {
    throw new Error("Label must not contain path separators");
  }
  if (s === "." || s === ".." || s.includes("..")) {
    throw new Error('Label must not contain ".."');
  }
  if (/\s/.test(s)) {
    throw new Error(
      kind === "operator"
        ? "Use dots instead of spaces (example: org.you)"
        : "Use dots instead of spaces (example: you.laptop)",
    );
  }
  if (!LABEL_RE.test(s)) {
    throw new Error(
      "Use ASCII letters, numbers, dots, underscores, or hyphens only",
    );
  }
}

export function assertSafeBotLabel(label: string): void {
  assertSafeLabel(label, "bot");
}

export function assertOperatorLabel(label: string): void {
  assertSafeLabel(label, "operator");
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
