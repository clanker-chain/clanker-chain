/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import { isSenderAllowed } from "../src/allow-policy.js";

test("same operator always allowed", () => {
  expect(
    isSenderAllowed({
      senderBotId: "a.bot",
      senderOperatorLabel: "org.me",
      selfOperatorLabel: "org.me",
      allowFrom: [],
      allowOperators: [],
    }),
  ).toBe(true);
});

test("allowFrom bot id", () => {
  expect(
    isSenderAllowed({
      senderBotId: "peer.bot",
      senderOperatorLabel: "org.peer",
      selfOperatorLabel: "org.me",
      allowFrom: ["peer.bot"],
      allowOperators: [],
    }),
  ).toBe(true);
});

test("allowOperators label", () => {
  expect(
    isSenderAllowed({
      senderBotId: "peer.bot",
      senderOperatorLabel: "org.peer",
      selfOperatorLabel: "org.me",
      allowFrom: [],
      allowOperators: ["org.peer"],
    }),
  ).toBe(true);
});

test("stranger denied when lists empty", () => {
  expect(
    isSenderAllowed({
      senderBotId: "stranger.bot",
      senderOperatorLabel: "org.stranger",
      selfOperatorLabel: "org.me",
      allowFrom: [],
      allowOperators: [],
    }),
  ).toBe(false);
});

test("dmPolicy=open allows strangers (Transport still applies on hub)", () => {
  expect(
    isSenderAllowed({
      senderBotId: "stranger.bot",
      senderOperatorLabel: "org.stranger",
      selfOperatorLabel: "org.me",
      dmPolicy: "open",
      allowFrom: [],
      allowOperators: [],
    }),
  ).toBe(true);
});

test("dmPolicy=pairing still denies empty lists", () => {
  expect(
    isSenderAllowed({
      senderBotId: "stranger.bot",
      senderOperatorLabel: "org.stranger",
      selfOperatorLabel: "org.me",
      dmPolicy: "pairing",
      allowFrom: [],
      allowOperators: [],
    }),
  ).toBe(false);
});
