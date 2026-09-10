/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import {
  isMqttAccountConfigured,
  resolveMqttAccount,
} from "../src/accounts.js";

const validHex = "0x1234567890123456789012345678901234567890";

function baseMqtt(overrides: Record<string, unknown> = {}) {
  return {
    channels: {
      mqtt: {
        enabled: true,
        botId: "openclaw.france.prod-1",
        operatorId: "org.openclaw.pat",
        brokerUrl: "mqtt://broker:1883",
        chainRpcUrl: "http://127.0.0.1:8545",
        registryAddress: validHex,
        ...overrides,
      },
    },
  };
}

test("resolveMqttAccount configured when all required fields are valid", () => {
  const account = resolveMqttAccount(baseMqtt());
  expect(account.configured).toBe(true);
  expect(isMqttAccountConfigured(account)).toBe(true);
});

test("resolveMqttAccount not configured when chainRpcUrl is missing", () => {
  const account = resolveMqttAccount(baseMqtt({ chainRpcUrl: "" }));
  expect(account.configured).toBe(false);
  expect(isMqttAccountConfigured(account)).toBe(false);
});

test("resolveMqttAccount not configured when registryAddress is empty", () => {
  const account = resolveMqttAccount(baseMqtt({ registryAddress: "" }));
  expect(account.configured).toBe(false);
});

test("resolveMqttAccount not configured when registryAddress is not 0x+40 hex", () => {
  for (const bad of [
    "not-an-address",
    "0x1234",
    "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    "1234567890123456789012345678901234567890",
    "0x12345678901234567890123456789012345678901",
  ]) {
    const account = resolveMqttAccount(baseMqtt({ registryAddress: bad }));
    expect(account.configured).toBe(false);
    expect(isMqttAccountConfigured(account)).toBe(false);
  }
});

test("resolveMqttAccount reads allowOperators", () => {
  const account = resolveMqttAccount(
    baseMqtt({ allowOperators: ["org.peer"], dmPolicy: "pairing" }),
  );
  expect(account.allowOperators).toEqual(["org.peer"]);
  expect(account.dmPolicy).toBe("pairing");
});
