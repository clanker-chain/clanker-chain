import * as ed25519 from "@noble/ed25519";

/**
 * Verify an Ed25519 signature over a message.
 * @param message - Raw string (will be UTF-8 encoded for verification)
 * @param signatureBase64 - Base64-encoded 64-byte signature
 * @param publicKeyBase64 - Base64-encoded 32-byte public key
 * @returns true if signature is valid
 */
export async function verifyEd25519(
  message: string,
  signatureBase64: string,
  publicKeyBase64: string,
): Promise<boolean> {
  try {
    const msgBytes = new TextEncoder().encode(message);
    const sig = Buffer.from(signatureBase64, "base64");
    const pub = Buffer.from(publicKeyBase64, "base64");
    if (sig.length !== 64 || pub.length !== 32) {
      return false;
    }
    return await ed25519.verifyAsync(sig, msgBytes, pub);
  } catch {
    return false;
  }
}
