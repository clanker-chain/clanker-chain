/**
 * Isolated poll() regression tests. Run only from this package:
 *   npm run test   (or: bun test test/poll.test.ts)
 * Do not rely on repo-wide `bun test` — this file mocks the `mqtt` module.
 */
import { EventEmitter } from "node:events";
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type FakeMqttClient = EventEmitter & {
  connected: boolean;
  end: (force: boolean, opts: object, cb: () => void) => void;
  publish: (...args: unknown[]) => void;
  subscribe: (topics: string[], cb: (err: null) => void) => void;
};

let fakeClient: FakeMqttClient;

mock.module("mqtt", () => ({
  default: {
    connect: () => {
      fakeClient = Object.assign(new EventEmitter(), {
        connected: false,
        end(_force: boolean, _opts: object, cb: () => void) {
          fakeClient.connected = false;
          cb();
        },
        publish() {},
        subscribe(_topics: string[], cb: (err: null) => void) {
          cb(null);
        },
      }) as FakeMqttClient;
      queueMicrotask(() => {
        fakeClient.connected = true;
        fakeClient.emit("connect");
      });
      return fakeClient;
    },
  },
}));

afterAll(() => {
  mock.restore();
});

const { MqttClient } = await import("../src/index.js");

function emitBrokerMessage(topic: string, payload: unknown): void {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  fakeClient.emit("message", topic, Buffer.from(body));
}

describe("MqttClient.poll", () => {
  let client: MqttClient;

  beforeEach(async () => {
    client = new MqttClient();
    await client.connect({
      brokerUrl: "mqtt://test",
      clientId: "test-bot",
      getPassword: async () => "pw",
    });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  test("empty poll timeouts do not leak message listeners", async () => {
    const baseline = fakeClient.listenerCount("message");
    for (let i = 0; i < 15; i++) {
      const out = await client.poll(5);
      expect(out).toEqual([]);
    }
    expect(fakeClient.listenerCount("message")).toBe(baseline);
  });

  test("message after empty poll is returned by the next poll", async () => {
    const first = await client.poll(10);
    expect(first).toEqual([]);

    emitBrokerMessage("bots/test-bot/inbox", { hello: 1 });

    const second = await client.poll(50);
    expect(second.length).toBe(1);
    expect(second[0]?.topic).toBe("bots/test-bot/inbox");
    expect(second[0]?.payload).toEqual({ hello: 1 });
  });

  test("buffered messages return immediately without adding a poll waiter", async () => {
    const baseline = fakeClient.listenerCount("message");
    emitBrokerMessage("bots/test-bot/inbox", { buffered: true });

    const out = await client.poll(100);
    expect(out.length).toBe(1);
    expect(out[0]?.payload).toEqual({ buffered: true });
    expect(fakeClient.listenerCount("message")).toBe(baseline);
  });

  test("disconnect clears the received buffer so stale messages are not replayed", async () => {
    emitBrokerMessage("bots/test-bot/inbox", { stale: true });
    await client.disconnect();

    await client.connect({
      brokerUrl: "mqtt://test",
      clientId: "test-bot-2",
      getPassword: async () => "pw",
    });

    const out = await client.poll(10);
    expect(out).toEqual([]);
  });
});
