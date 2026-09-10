/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import {
  dmPairSegment,
  parseDmTopic,
  topicForDmCoordination,
} from "../src/dm-topics.js";

test("dmPairSegment sorts and joins with ::", () => {
  const a = "openclaw.france.prod-1";
  const b = "openclaw.tooter.prod-1";
  expect(dmPairSegment(a, b)).toBe([a, b].sort().join("::"));
  expect(dmPairSegment(b, a)).toBe(dmPairSegment(a, b));
});

test("topicForDmCoordination uses dmPairSegment (not hyphen join)", () => {
  const a = "alice-bot";
  const b = "bob";
  expect(topicForDmCoordination(a, b)).toBe(`dm/${dmPairSegment(a, b)}/coordination`);
  expect(topicForDmCoordination(a, b)).not.toContain("alice-bot-bob");
  expect(topicForDmCoordination(a, b)).toBe("dm/alice-bot::bob/coordination");
});

test("parseDmTopic round-trips hyphenated prod labels", () => {
  const a = "openclaw.france.prod-1";
  const b = "openclaw.tooter.prod-1";
  const topic = topicForDmCoordination(a, b);
  const parsed = parseDmTopic(topic);
  expect(parsed).not.toBeNull();
  expect([parsed!.a, parsed!.b].sort()).toEqual([a, b].sort());
});

test("parseDmTopic rejects legacy hyphen-joined segments", () => {
  expect(parseDmTopic("dm/alice-bot-bob/coordination")).toBeNull();
  expect(parseDmTopic(`dm/${["alice-bot", "bob"].sort().join("-")}/x`)).toBeNull();
});

test("dmPairSegment rejects :: in labels", () => {
  expect(() => dmPairSegment("a::b", "c")).toThrow();
  expect(() => topicForDmCoordination("a::b", "c")).toThrow();
});
