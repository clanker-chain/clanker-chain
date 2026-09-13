/**
 * HPKE recipient helpers for Privy device-grant wallet authenticate.
 * Ported from @privy-io/node cryptography (DhkemP256 + ChaCha20Poly1305).
 */

import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import canonicalize from "canonicalize";

/**
 * @returns {Promise<{
 *   publicKeySpkiBase64: string,
 *   decryptPayload: (encapsulatedKey: Uint8Array, ciphertext: Uint8Array) => Promise<Uint8Array>,
 * }>}
 */
export async function setupHpkeRecipient() {
  const suite = new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Chacha20Poly1305(),
  });

  const keypair = await suite.kem.generateKeyPair();
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("crypto.subtle required for Privy HPKE (Node 20+)");
  }
  const publicKeySpki = new Uint8Array(
    await subtle.exportKey("spki", keypair.publicKey),
  );

  return {
    publicKeySpkiBase64: Buffer.from(publicKeySpki).toString("base64"),
    decryptPayload: async (encapsulatedKey, ciphertext) => {
      const recipient = await suite.createRecipientContext({
        recipientKey: keypair.privateKey,
        enc: encapsulatedKey,
      });
      return new Uint8Array(await recipient.open(ciphertext));
    },
  };
}

/**
 * Import Privy authorization private key (base64 PKCS8, optional wallet-auth: prefix).
 * @param {string} privateKey
 * @returns {Uint8Array} raw 32-byte scalar for noble P-256
 */
export function importPkcs8PrivateKey(privateKey) {
  const stripped = String(privateKey)
    .replace(/^wallet-auth:/, "")
    .replace(/^wallet-api:/, "")
    .trim();
  const pkcs8Bytes = Buffer.from(stripped, "base64");
  const marker = Buffer.from([0x04, 0x20]);
  const start = pkcs8Bytes.indexOf(marker);
  if (start === -1) {
    throw new Error("Invalid Privy authorization private key");
  }
  return pkcs8Bytes.subarray(start + 2, start + 34);
}

/**
 * Build + sign Privy authorization signature (P-256 ECDSA over RFC 8785 canonical JSON).
 * @param {{
 *   authorizationPrivateKey: string,
 *   method: 'POST'|'PUT'|'PATCH'|'DELETE',
 *   url: string,
 *   body: object,
 *   appId: string,
 * }} opts
 * @returns {string} base64 DER signature
 */
export function generateAuthorizationSignature(opts) {
  const payload = {
    version: 1,
    method: opts.method,
    url: opts.url,
    body: opts.body,
    headers: {
      "privy-app-id": opts.appId,
    },
  };
  if (
    typeof payload.body === "object" &&
    payload.body !== null &&
    Object.keys(payload.body).length === 0
  ) {
    payload.body = "";
  }
  const serialized = canonicalize(payload);
  if (!serialized) {
    throw new Error("Failed to canonicalize Privy authorization payload");
  }
  const bytes = new TextEncoder().encode(serialized);
  const sk = importPkcs8PrivateKey(opts.authorizationPrivateKey);
  const signature = p256.sign(sha256(bytes), sk).toBytes("der");
  return Buffer.from(signature).toString("base64");
}
