/**
 * File-backed pairing store (Policy layer — docs/trust-model.md).
 * Keys are lowercase 0x + 64 hex operator ids (keccak256 of operator label).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";

export interface PairingEntry {
  label: string;
  allowOperatorIds: string[];
  allowBotIds: string[];
}

export type PairingStoreData = Record<string, PairingEntry>;

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

export function emptyEntry(label = ""): PairingEntry {
  return { label, allowOperatorIds: [], allowBotIds: [] };
}

export class PairingStore {
  private data: PairingStoreData = {};
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) {
      this.data = {};
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as PairingStoreData;
      this.data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      this.data = {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    renameSync(tmp, this.path);
  }

  get(operatorId: Hex | string): PairingEntry {
    const key = normalizeId(String(operatorId));
    return this.data[key] ?? emptyEntry();
  }

  /** Whether `fromOperatorId` is allow-listed by `ownerOperatorId`. */
  allowsOperator(ownerOperatorId: Hex | string, fromOperatorId: Hex | string): boolean {
    const owner = normalizeId(String(ownerOperatorId));
    const from = normalizeId(String(fromOperatorId));
    if (owner === from) return true;
    const entry = this.data[owner];
    if (!entry) return false;
    return entry.allowOperatorIds.some((id) => normalizeId(id) === from);
  }

  /** Whether `fromBotId` is explicitly allow-listed by `ownerOperatorId`. */
  allowsBot(ownerOperatorId: Hex | string, fromBotId: string): boolean {
    const entry = this.data[normalizeId(String(ownerOperatorId))];
    if (!entry) return false;
    return entry.allowBotIds.includes(fromBotId);
  }

  /** Mutual: each operator allow-lists the other (or same operator). */
  isMutual(a: Hex | string, b: Hex | string): boolean {
    return this.allowsOperator(a, b) && this.allowsOperator(b, a);
  }

  addOperator(
    ownerOperatorId: Hex | string,
    ownerLabel: string,
    peerOperatorId: Hex | string,
  ): PairingEntry {
    const key = normalizeId(String(ownerOperatorId));
    const peer = normalizeId(String(peerOperatorId));
    const prev = this.data[key] ?? emptyEntry(ownerLabel);
    const allowOperatorIds = prev.allowOperatorIds.some((id) => normalizeId(id) === peer)
      ? prev.allowOperatorIds
      : [...prev.allowOperatorIds, peer];
    const next: PairingEntry = {
      label: ownerLabel || prev.label,
      allowOperatorIds,
      allowBotIds: [...prev.allowBotIds],
    };
    this.data[key] = next;
    this.persist();
    return next;
  }

  removeOperator(
    ownerOperatorId: Hex | string,
    peerOperatorId: Hex | string,
  ): PairingEntry {
    const key = normalizeId(String(ownerOperatorId));
    const peer = normalizeId(String(peerOperatorId));
    const prev = this.data[key] ?? emptyEntry();
    const next: PairingEntry = {
      ...prev,
      allowOperatorIds: prev.allowOperatorIds.filter((id) => normalizeId(id) !== peer),
    };
    this.data[key] = next;
    this.persist();
    return next;
  }

  list(ownerOperatorId: Hex | string): PairingEntry {
    return this.get(ownerOperatorId);
  }
}
