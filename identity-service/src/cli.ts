/**
 * CLI for the identity service (auth-free mint flow).
 *
 * Usage:
 *   bun run src/cli.ts mint-operator <operator_id> [display_name]
 *   bun run src/cli.ts mint-bot <bot_id> <operator_id> [display_name]
 *   bun run src/cli.ts mint-bot-token <bot_id> <operator_id> [display_name]
 *   bun run src/cli.ts add-key <bot_id> <public_key_base64>
 *   bun run src/cli.ts get-operator <operator_id>
 *   bun run src/cli.ts get-bot <bot_id>
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as ed25519 from "@noble/ed25519";

const BASE_URL = Bun.env.IDENTITY_SERVICE_URL ?? "http://localhost:8080";
const DEFAULT_OPERATOR_KEY_DIR = path.join(os.homedir(), ".openclaw", "keys", "operators");
const DEFAULT_BOT_KEY_DIR = path.join(os.homedir(), ".openclaw", "keys");

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd) {
    printHelp();
    process.exit(1);
  }

  try {
    switch (cmd) {
      case "mint-operator":
        await mintOperator(args);
        break;
      case "mint-bot":
        await mintBot(args);
        break;
      case "mint-bot-token":
        await mintBotToken(args);
        break;
      case "add-key":
        await addKey(args);
        break;
      case "get-operator":
        await getOperatorCmd(args);
        break;
      case "get-bot":
        await getBotCmd(args);
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error("Error:", (err as Error).message);
    process.exit(1);
  }
}

function operatorKeyPath(operatorId: string): string {
  return path.join(DEFAULT_OPERATOR_KEY_DIR, `${operatorId}.key`);
}

function botKeyPath(botId: string): string {
  return path.join(DEFAULT_BOT_KEY_DIR, `${botId}.key`);
}

async function readOrCreateOperatorPrivateKey(operatorId: string): Promise<Uint8Array> {
  const keyPath = operatorKeyPath(operatorId);
  try {
    const raw = await fs.readFile(keyPath, "utf8");
    const bytes = Buffer.from(raw.trim(), "base64");
    if (bytes.length !== 32) throw new Error("Invalid operator key length");
    return new Uint8Array(bytes);
  } catch {
    await fs.mkdir(DEFAULT_OPERATOR_KEY_DIR, { recursive: true });
    const priv = ed25519.utils.randomPrivateKey();
    await fs.writeFile(keyPath, `${Buffer.from(priv).toString("base64")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    console.error("Created new operator key at", keyPath);
    return priv;
  }
}

async function mintOperator(args: string[]) {
  const [operator_id, display_name] = args;
  if (!operator_id) {
    throw new Error("Usage: mint-operator <operator_id> [display_name]");
  }
  const priv = await readOrCreateOperatorPrivateKey(operator_id);
  const pub = await ed25519.getPublicKeyAsync(priv);
  const public_key = Buffer.from(pub).toString("base64");
  const timestamp = new Date().toISOString();
  const message = `mint-operator:${operator_id}:${public_key}:${timestamp}`;
  const msgBytes = new TextEncoder().encode(message);
  const sig = await ed25519.signAsync(msgBytes, priv);
  const signature = Buffer.from(sig).toString("base64");

  const res = await fetch(`${BASE_URL}/v1/operators`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operator_id, display_name, public_key, signature, message }),
  });
  await printResponse(res);
}

async function mintBot(args: string[]) {
  const [bot_id, operator_id, display_name] = args;
  if (!bot_id || !operator_id) {
    throw new Error("Usage: mint-bot <bot_id> <operator_id> [display_name]");
  }
  const operatorPriv = await readOrCreateOperatorPrivateKey(operator_id);
  const botPriv = ed25519.utils.randomPrivateKey();
  const botPub = await ed25519.getPublicKeyAsync(botPriv);
  const bot_public_key = Buffer.from(botPub).toString("base64");

  const keyPath = botKeyPath(bot_id);
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.writeFile(keyPath, `${Buffer.from(botPriv).toString("base64")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.error("Bot key written to", keyPath);

  const timestamp = new Date().toISOString();
  const message = `mint-bot:${bot_id}:${operator_id}:${bot_public_key}:${timestamp}`;
  const msgBytes = new TextEncoder().encode(message);
  const sig = await ed25519.signAsync(msgBytes, operatorPriv);
  const operator_signature = Buffer.from(sig).toString("base64");

  const res = await fetch(`${BASE_URL}/v1/bots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bot_id,
      operator_id,
      display_name,
      bot_public_key,
      operator_signature,
      message,
    }),
  });
  await printResponse(res);
}

/**
 * Create a pre-signed bot registration payload (\"mint token\") that can be
 * handed to a bot. The token is simply the JSON body that the bot should POST
 * to the identity service's /v1/bots endpoint.
 *
 * This command:
 * - Ensures the operator key exists (and creates it if missing).
 * - Generates a new bot keypair and writes the private key to
 *   ~/.openclaw/keys/<bot_id>.key (so you can securely transfer it to the bot).
 * - Prints the JSON payload the bot should POST to /v1/bots.
 */
async function mintBotToken(args: string[]) {
  const [bot_id, operator_id, display_name] = args;
  if (!bot_id || !operator_id) {
    throw new Error("Usage: mint-bot-token <bot_id> <operator_id> [display_name]");
  }
  const operatorPriv = await readOrCreateOperatorPrivateKey(operator_id);
  const botPriv = ed25519.utils.randomPrivateKey();
  const botPub = await ed25519.getPublicKeyAsync(botPriv);
  const bot_public_key = Buffer.from(botPub).toString("base64");

  const keyPath = botKeyPath(bot_id);
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.writeFile(keyPath, `${Buffer.from(botPriv).toString("base64")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.error("Bot key written to", keyPath);

  const timestamp = new Date().toISOString();
  const message = `mint-bot:${bot_id}:${operator_id}:${bot_public_key}:${timestamp}`;
  const msgBytes = new TextEncoder().encode(message);
  const sig = await ed25519.signAsync(msgBytes, operatorPriv);
  const operator_signature = Buffer.from(sig).toString("base64");

  const payload = {
    bot_id,
    operator_id,
    display_name,
    bot_public_key,
    operator_signature,
    message,
  };

  // This JSON can be POSTed directly to /v1/bots on the identity service.
  console.log(JSON.stringify(payload, null, 2));
}

async function addKey(args: string[]) {
  const [bot_id, public_key] = args;
  if (!bot_id || !public_key) {
    throw new Error("Usage: add-key <bot_id> <public_key_base64>");
  }
  const botRes = await fetch(`${BASE_URL}/v1/bots/${encodeURIComponent(bot_id)}`);
  if (!botRes.ok) {
    const t = await botRes.text();
    throw new Error(t || `Bot not found: ${bot_id}`);
  }
  const bot = (await botRes.json()) as { operator_id: string };
  const operator_id = bot.operator_id;
  if (!operator_id) throw new Error("Bot record has no operator_id");

  const operatorPriv = await readOrCreateOperatorPrivateKey(operator_id);
  const timestamp = new Date().toISOString();
  const message = `add-bot-key:${bot_id}:${public_key}:${timestamp}`;
  const msgBytes = new TextEncoder().encode(message);
  const sig = await ed25519.signAsync(msgBytes, operatorPriv);
  const operator_signature = Buffer.from(sig).toString("base64");

  const res = await fetch(`${BASE_URL}/v1/bots/${encodeURIComponent(bot_id)}/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ public_key, operator_signature, message }),
  });
  await printResponse(res);
}

async function getOperatorCmd(args: string[]) {
  const [operator_id] = args;
  if (!operator_id) {
    throw new Error("Usage: get-operator <operator_id>");
  }
  const res = await fetch(`${BASE_URL}/v1/operators/${encodeURIComponent(operator_id)}`);
  await printResponse(res);
}

async function getBotCmd(args: string[]) {
  const [bot_id] = args;
  if (!bot_id) {
    throw new Error("Usage: get-bot <bot_id>");
  }
  const res = await fetch(`${BASE_URL}/v1/bots/${encodeURIComponent(bot_id)}`);
  await printResponse(res);
}

async function printResponse(res: Response) {
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.log(text);
    return;
  }
  console.log(JSON.stringify(parsed, null, 2));
}

function printHelp() {
  console.log(
    [
      "Identity service CLI (auth-free mint):",
      "  mint-operator <operator_id> [display_name]",
      "  mint-bot <bot_id> <operator_id> [display_name]",
      "  mint-bot-token <bot_id> <operator_id> [display_name]",
      "  add-key <bot_id> <public_key_base64>",
      "  get-operator <operator_id>",
      "  get-bot <bot_id>",
    ].join("\n"),
  );
}

void main();
