/**
 * Ephemeral bot private key held outside React state.
 * Cleared on confirm-saved, logout, and beforeunload while pending.
 */

import type { Hex } from "viem";

let pendingBotKey: Hex | null = null;
let pendingBotLabel: string | null = null;

export function setPendingBotKey(label: string, key: Hex): void {
  pendingBotLabel = label;
  pendingBotKey = key;
}

export function peekPendingBotKey(): {
  label: string;
  key: Hex;
} | null {
  if (!pendingBotKey || !pendingBotLabel) return null;
  return { label: pendingBotLabel, key: pendingBotKey };
}

export function clearPendingBotKey(): void {
  pendingBotKey = null;
  pendingBotLabel = null;
}

export function hasPendingBotKey(): boolean {
  return pendingBotKey !== null;
}
