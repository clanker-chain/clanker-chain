/// <reference types="node" />

/**
 * One-time genesis bootstrap: create ledger with a single operator and no bots.
 * Refuses to run if the ledger file already exists (delete it manually for a fresh genesis).
 *
 * Usage: bun run scripts/bootstrap-genesis.ts <operator_id> [display_name]
 * Example: bun run scripts/bootstrap-genesis.ts org.openclaw.pat "Pat"
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import * as ed25519 from "@noble/ed25519";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LEDGER_PATH =
  process.env.IDENTITY_LEDGER_PATH ??
  path.resolve(__dirname, "../../identity/bot-identity-ledger.json");

const DEFAULT_KEY_DIR = path.join(os.homedir(), ".openclaw", "keys", "operators");

async function main() {
  const [, , operator_id, display_name] = process.argv;
  if (!operator_id) {
    console.error("Usage: bun run scripts/bootstrap-genesis.ts <operator_id> [display_name]");
    process.exit(1);
  }

  if (await exists(LEDGER_PATH)) {
    console.error("Ledger already exists. Refusing to overwrite.");
    console.error("Delete it manually if you want a fresh genesis.");
    process.exit(1);
  }

  const priv = ed25519.utils.randomPrivateKey();
  const pub = await ed25519.getPublicKeyAsync(priv);
  const publicKeyBase64 = Buffer.from(pub).toString("base64");
  const privateKeyBase64 = Buffer.from(priv).toString("base64");

  const now = new Date().toISOString();
  const keyId = `${operator_id}-genesis-1`;

  const ledger = {
    $schema: "https://example.com/schemas/bot-identity-ledger.schema.json",
    version: 1,
    created: now,
    updated: now,
    operators: {
      [operator_id]: {
        operator_id,
        display_name: display_name ?? operator_id,
        public_keys: [
          {
            key_id: keyId,
            algorithm: "ed25519",
            public_key: publicKeyBase64,
            created: now,
            status: "active",
          },
        ],
        status: "active",
        created: now,
        updated: now,
      },
    },
    bots: {},
    operations: [],
  };

  await fs.mkdir(path.dirname(LEDGER_PATH), { recursive: true });
  await fs.writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2), "utf8");

  const keyPath = path.join(DEFAULT_KEY_DIR, `${operator_id}.key`);
  await fs.mkdir(DEFAULT_KEY_DIR, { recursive: true });
  await fs.writeFile(keyPath, `${privateKeyBase64}\n`, { encoding: "utf8", mode: 0o600 });

  console.log("Genesis ledger created.");
  console.log("Operator ID:", operator_id);
  console.log("Key path:", keyPath);
  console.log("Public key (base64):", publicKeyBase64);
}

function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
