/**
 * Simple CLI wrapper around the identity service HTTP API.
 *
 * Usage examples:
 *   bun run src/cli.ts create-operator org.openclaw.pat "Pat"
 *   bun run src/cli.ts create-bot openclaw.france.prod-1 org.openclaw.pat "france-bot"
 *   bun run src/cli.ts add-key openclaw.france.prod-1 ed25519 BASE64_KEY
 */

const BASE_URL = Bun.env.IDENTITY_SERVICE_URL ?? "http://localhost:8080";

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd) {
    printHelp();
    process.exit(1);
  }

  try {
    switch (cmd) {
      case "create-operator":
        await createOperator(args);
        break;
      case "create-bot":
        await createBot(args);
        break;
      case "add-key":
        await addKey(args);
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

function adminHeaders(): HeadersInit {
  const token = Bun.env.IDENTITY_ADMIN_TOKEN;
  const headers: HeadersInit = {
    "content-type": "application/json",
  };
  if (token) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function createOperator(args: string[]) {
  const [operator_id, display_name] = args;
  if (!operator_id) {
    throw new Error("Usage: create-operator <operator_id> [display_name]");
  }
  const res = await fetch(`${BASE_URL}/v1/operators`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ operator_id, display_name }),
  });
  await printResponse(res);
}

async function createBot(args: string[]) {
  const [bot_id, operator_id, display_name] = args;
  if (!bot_id || !operator_id) {
    throw new Error("Usage: create-bot <bot_id> <operator_id> [display_name]");
  }
  const res = await fetch(`${BASE_URL}/v1/bots`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ bot_id, operator_id, display_name }),
  });
  await printResponse(res);
}

async function addKey(args: string[]) {
  const [bot_id, algorithm, public_key] = args;
  if (!bot_id || !algorithm || !public_key) {
    throw new Error("Usage: add-key <bot_id> <algorithm> <base64_public_key>");
  }
  const res = await fetch(`${BASE_URL}/v1/bots/${encodeURIComponent(bot_id)}/keys`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ algorithm, public_key }),
  });
  await printResponse(res);
}

async function getBotCmd(args: string[]) {
  const [bot_id] = args;
  if (!bot_id) {
    throw new Error("Usage: get-bot <bot_id>");
  }
  const res = await fetch(`${BASE_URL}/v1/bots/${encodeURIComponent(bot_id)}`, {
    method: "GET",
  });
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
      "Identity service CLI commands:",
      "  create-operator <operator_id> [display_name]",
      "  create-bot <bot_id> <operator_id> [display_name]",
      "  add-key <bot_id> <algorithm> <base64_public_key>",
      "  get-bot <bot_id>",
    ].join("\n"),
  );
}

void main();

