/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, toBytes } from "viem";
import { dmPairSegment, parseDmTopic } from "../src/acl.js";
import { PairingStore } from "../src/pairing-store.js";

test("parseDmTopic splits sorted bot labels on ::", () => {
  const a = "openclaw.france.prod-1";
  const b = "openclaw.tooter.prod-1";
  const segment = dmPairSegment(a, b);
  expect(segment).toBe([a, b].sort().join("::"));
  const parsed = parseDmTopic(`dm/${segment}/coordination`);
  expect(parsed).not.toBeNull();
  expect([parsed!.a, parsed!.b].sort()).toEqual([a, b].sort());
});

test("parseDmTopic rejects hyphen-joined segments (ambiguous for prod-1 labels)", () => {
  const a = "alice-bot";
  const b = "bob";
  // Legacy / buggy encoding that collides with label hyphens
  const hyphenSegment = [a, b].sort().join("-");
  expect(parseDmTopic(`dm/${hyphenSegment}/coordination`)).toBeNull();
  // Would have parsed as alice + bot-bob under first-`-` split
  expect(parseDmTopic("dm/alice-bot-bob/x")).toBeNull();
});

test("parseDmTopic rejects unsorted :: segments", () => {
  expect(parseDmTopic("dm/z::a/coordination")).toBeNull();
});

test("dmPairSegment rejects :: inside labels", () => {
  expect(() => dmPairSegment("a::b", "c")).toThrow();
});

test("parseDmTopic returns null for non-dm topics", () => {
  expect(parseDmTopic("bots/x/inbox")).toBeNull();
});

test("PairingStore add/remove and mutual", () => {
  const dir = mkdtempSync(join(tmpdir(), "pair-"));
  const path = join(dir, "pairing.json");
  try {
    const store = new PairingStore(path);
    const opA = keccak256(toBytes("org.a"));
    const opB = keccak256(toBytes("org.b"));
    expect(store.allowsOperator(opA, opB)).toBe(false);
    store.addOperator(opA, "org.a", opB);
    expect(store.allowsOperator(opA, opB)).toBe(true);
    expect(store.isMutual(opA, opB)).toBe(false);
    store.addOperator(opB, "org.b", opA);
    expect(store.isMutual(opA, opB)).toBe(true);
    const reloaded = new PairingStore(path);
    expect(reloaded.isMutual(opA, opB)).toBe(true);
    store.removeOperator(opA, opB);
    expect(store.allowsOperator(opA, opB)).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8"))[opA.toLowerCase()].allowOperatorIds).toEqual(
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
