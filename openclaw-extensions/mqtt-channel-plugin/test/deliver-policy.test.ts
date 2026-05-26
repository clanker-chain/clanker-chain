import { expect, test } from "bun:test";
import { resolveDeliverDecision } from "../src/deliver-policy.js";

test("flag isNoReply suppresses publish", () => {
  const decision = resolveDeliverDecision({ text: "hello", isNoReply: true });
  expect(decision).toEqual({ publish: false, reason: "flag" });
});

test("flag isNoReply with whitespace-only body reports flag not empty", () => {
  const decision = resolveDeliverDecision({ text: "   ", isNoReply: true });
  expect(decision).toEqual({ publish: false, reason: "flag" });
});

test("NO_REPLY exact marker suppresses publish (case-insensitive)", () => {
  const decision = resolveDeliverDecision({ text: "NO_REPLY" });
  expect(decision).toEqual({ publish: false, reason: "no_reply_marker" });
});

test("NO_REPLY prefix marker suppresses publish (newline)", () => {
  const decision = resolveDeliverDecision({ text: "no_reply\nsummary" });
  expect(decision).toEqual({ publish: false, reason: "no_reply_marker" });
});

test("leading whitespace before NO_REPLY on first line suppresses", () => {
  const decision = resolveDeliverDecision({ text: " NO_REPLY\nsummary" });
  expect(decision).toEqual({ publish: false, reason: "no_reply_marker" });
});

test("blank lines before NO_REPLY suppress", () => {
  const decision = resolveDeliverDecision({ text: "\n\nNO_REPLY\nsummary" });
  expect(decision).toEqual({ publish: false, reason: "no_reply_marker" });
});

test("NO_REPLY with trailing text on same line publishes", () => {
  const decision = resolveDeliverDecision({ text: "NO_REPLY trailing text" });
  expect(decision).toEqual({
    publish: true,
    text: "NO_REPLY trailing text",
    replyToId: undefined,
  });
});

test("NO_REPLY marker in text suppresses even when media present", () => {
  const decision = resolveDeliverDecision({
    text: "NO_REPLY",
    mediaUrls: ["https://example.com/a.png"],
  });
  expect(decision).toEqual({ publish: false, reason: "no_reply_marker" });
});

test("JSON wrapper isNoReply suppresses publish", () => {
  const decision = resolveDeliverDecision({
    text: `{"isNoReply":true,"task_id":"x"}`,
  });
  expect(decision).toEqual({ publish: false, reason: "json_wrapper" });
});

test("JSON wrapper without isNoReply publishes", () => {
  const decision = resolveDeliverDecision({ text: `{"task_id":"x"}` });
  expect(decision).toEqual({ publish: true, text: `{"task_id":"x"}`, replyToId: undefined });
});

test("normal text publishes (normalized)", () => {
  const decision = resolveDeliverDecision({ text: " hello  " });
  expect(decision).toEqual({ publish: true, text: " hello  ", replyToId: undefined });
});

test("empty/whitespace suppresses publish", () => {
  const decision = resolveDeliverDecision({ text: "   " });
  expect(decision).toEqual({ publish: false, reason: "empty" });
});

test("media-only deliver publishes (joined as body)", () => {
  const decision = resolveDeliverDecision({ mediaUrls: ["url-1", "url-2"] });
  expect(decision).toEqual({ publish: true, text: "url-1\nurl-2", replyToId: undefined });
});

test("text empty with single mediaUrl publishes", () => {
  const decision = resolveDeliverDecision({ text: "", mediaUrl: "url-only" });
  expect(decision).toEqual({ publish: true, text: "url-only", replyToId: undefined });
});
