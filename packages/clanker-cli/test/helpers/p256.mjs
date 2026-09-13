/**
 * Test helper: generate P-256 PKCS8 / SPKI base64 (WebCrypto).
 */

export async function generateP256KeyPair() {
  const subtle = globalThis.crypto.subtle;
  const keyPair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const [publicKeyDer, privateKeyDer] = await Promise.all([
    subtle.exportKey("spki", keyPair.publicKey),
    subtle.exportKey("pkcs8", keyPair.privateKey),
  ]);
  return {
    publicKey: Buffer.from(publicKeyDer).toString("base64"),
    privateKey: Buffer.from(privateKeyDer).toString("base64"),
  };
}
