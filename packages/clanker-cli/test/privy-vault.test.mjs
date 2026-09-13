import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import {
  generateAuthorizationSignature,
  importPkcs8PrivateKey,
  setupHpkeRecipient,
} from "../lib/privy-hpke.mjs";
import {
  clearPrivySession,
  loadPrivySession,
  savePrivySession,
} from "../lib/privy-session.mjs";
import {
  pollDeviceToken,
  requestDeviceAuthorization,
} from "../lib/privy-client.mjs";
import { resolveOperatorSigner } from "../lib/operator-signer.mjs";
import { initProfile, writeOperator } from "../lib/profile.mjs";
import { generateP256KeyPair } from "./helpers/p256.mjs";

describe("privy HPKE helpers", () => {
  it("setupHpkeRecipient returns base64 SPKI", async () => {
    const r = await setupHpkeRecipient();
    assert.ok(r.publicKeySpkiBase64.length > 40);
    const round = Buffer.from(r.publicKeySpkiBase64, "base64");
    assert.ok(round.length > 50);
  });

  it("signs authorization payloads with PKCS8 P-256", async () => {
    const { privateKey } = await generateP256KeyPair();
    const sig = generateAuthorizationSignature({
      authorizationPrivateKey: privateKey,
      method: "POST",
      url: "https://auth.privy.io/api/oauth/v2/wallets/wallet_x/rpc",
      body: { method: "personal_sign", params: { message: "hi" } },
      appId: "test-app",
    });
    assert.ok(typeof sig === "string" && sig.length > 20);
    assert.doesNotThrow(() => importPkcs8PrivateKey(privateKey));
  });
});

describe("privy session store", () => {
  it("saves and loads file session when keychain unavailable", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-privy-sess-"));
    // Force file path: clear any keychain entry first via clear
    clearPrivySession(home);
    const session = {
      appId: "app",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 60_000,
      walletId: "wallet_1",
      address: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      createdAt: Date.now(),
    };
    // On macOS save may use keychain — still loadable
    savePrivySession(session, home);
    const loaded = loadPrivySession(home);
    assert.ok(loaded);
    assert.equal(loaded.walletId, "wallet_1");
    assert.equal(
      getAddress(loaded.address),
      getAddress(session.address),
    );
    clearPrivySession(home);
    assert.equal(loadPrivySession(home), null);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("privy client (mocked HTTP)", () => {
  it("requestDeviceAuthorization parses codes", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          device_code: "dev",
          user_code: "ABCD-1234",
          verification_uri: "https://clanker-chain.com/authorize",
          verification_uri_complete:
            "https://clanker-chain.com/authorize?user_code=ABCD-1234",
          expires_in: 600,
          interval: 1,
        }),
    });
    const d = await requestDeviceAuthorization({
      appId: "app",
      fetchImpl,
    });
    assert.equal(d.userCode, "ABCD-1234");
    assert.equal(d.deviceCode, "dev");
  });

  it("pollDeviceToken returns tokens after pending", async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      if (n === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: "authorization_pending" }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 900,
          }),
      };
    };
    const tokens = await pollDeviceToken({
      appId: "app",
      deviceCode: "dev",
      interval: 0.001,
      expiresIn: 30,
      fetchImpl,
      sleep: async () => {},
    });
    assert.equal(tokens.accessToken, "at");
    assert.equal(tokens.refreshToken, "rt");
  });
});

describe("resolveOperatorSigner privy", () => {
  it("uses privy session without local key", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-privy-sign-"));
    initProfile("sepolia", { home, force: true });
    const address = "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4";
    writeOperator(
      {
        label: "org.you",
        owner: address,
        key: { type: "privy", value: "wallet_abc" },
      },
      home,
    );
    savePrivySession(
      {
        appId: "app",
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: Date.now() + 120_000,
        walletId: "wallet_abc",
        address,
        createdAt: Date.now(),
      },
      home,
    );

    // Mock wallet RPC for personal_sign
    const fetchImpl = async (url, init) => {
      const u = String(url);
      if (u.includes("/wallets/authenticate")) {
        // Can't easily mock HPKE decrypt without real encryption — skip full RPC.
        // Just ensure resolveOperatorSigner returns privy kind without calling network
        // until signMessage. For this test we only check kind/address.
        return {
          ok: false,
          status: 500,
          text: async () => "not used yet",
        };
      }
      return { ok: false, status: 404, text: async () => "" };
    };

    const signer = await resolveOperatorSigner([], {
      home,
      env: {},
      fetchImpl,
    });
    assert.equal(signer.kind, "privy");
    assert.equal(getAddress(signer.address), getAddress(address));
    assert.deepEqual(signer.keyPointer, { type: "privy", value: "wallet_abc" });
    clearPrivySession(home);
    rmSync(home, { recursive: true, force: true });
  });
});
