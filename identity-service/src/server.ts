import { jsonError, jsonResponse, signatureInvalid } from "./auth";
import { verifyEd25519 } from "./crypto";
import {
  addBotKey,
  appendOperation,
  getBot,
  getLedgerSnapshot,
  getOperator,
  loadLedger,
  type BotRecord,
  type OperatorRecord,
  type PublicKeyRecord,
  upsertBot,
  upsertOperator,
} from "./ledger";
import {
  type AddKeySignedBody,
  type MintBotBody,
  type MintOperatorBody,
  validateAddKeySigned,
  validateMintBot,
  validateMintOperator,
} from "./validation";

// Ensure ledger is loaded on startup
void loadLedger();

function notFound(): Response {
  return jsonError(404, "not_found", "Route not found");
}

function methodNotAllowed(): Response {
  return jsonError(405, "method_not_allowed", "Method not allowed");
}

function getOperatorActivePublicKey(operator: OperatorRecord): string | undefined {
  const key = operator.public_keys?.find((k) => k.status === "active");
  return key?.public_key;
}

async function handlePostOperators(request: Request): Promise<Response> {
  let body: MintOperatorBody;
  try {
    const json = await request.json();
    body = validateMintOperator(json);
  } catch (err) {
    return jsonError(400, "invalid_request", (err as Error).message);
  }

  const valid = await verifyEd25519(body.message, body.signature, body.public_key);
  if (!valid) {
    return signatureInvalid("Signature verification failed");
  }

  const ledger = await getLedgerSnapshot();
  if (ledger.operators[body.operator_id]) {
    return jsonError(409, "conflict", "operator_id already exists");
  }

  const now = new Date().toISOString();
  const keyId = `${body.operator_id}-${now}`;
  const record: OperatorRecord = {
    operator_id: body.operator_id,
    display_name: body.display_name,
    public_keys: [
      {
        key_id: keyId,
        algorithm: "ed25519",
        public_key: body.public_key,
        created: now,
        status: "active",
      },
    ],
    status: "active",
    created: now,
    updated: now,
  };

  await upsertOperator(record);
  const timestamp = body.message.slice(`mint-operator:${body.operator_id}:${body.public_key}:`.length);
  await appendOperation({
    type: "mint-operator",
    operator_id: body.operator_id,
    public_key: body.public_key,
    signature: body.signature,
    message: body.message,
    timestamp: timestamp || now,
  });
  return jsonResponse(201, record);
}

async function handlePostBots(request: Request): Promise<Response> {
  let body: MintBotBody;
  try {
    const ledger = await getLedgerSnapshot();
    body = validateMintBot(request.json ? await request.json() : {}, ledger.operators, ledger.bots);
  } catch (err) {
    return jsonError(400, "invalid_request", (err as Error).message);
  }

  const operator = await getOperator(body.operator_id);
  if (!operator) {
    return jsonError(400, "invalid_request", "operator_id does not exist");
  }
  const operatorPubKey = getOperatorActivePublicKey(operator);
  if (!operatorPubKey) {
    return jsonError(400, "invalid_request", "operator has no active public key");
  }

  const valid = await verifyEd25519(body.message, body.operator_signature, operatorPubKey);
  if (!valid) {
    return signatureInvalid("Operator signature verification failed");
  }

  const now = new Date().toISOString();
  const keyId = `${body.bot_id}-${now}`;
  const keyRecord: PublicKeyRecord = {
    key_id: keyId,
    algorithm: "ed25519",
    public_key: body.bot_public_key,
    created: now,
    status: "active",
  };
  const record: BotRecord = {
    bot_id: body.bot_id,
    display_name: body.display_name,
    operator_id: body.operator_id,
    aliases: body.aliases,
    public_keys: [keyRecord],
    status: "active",
    created: now,
    updated: now,
    metadata: body.metadata,
  };

  await upsertBot(record);
  const timestamp = body.message.slice(`mint-bot:${body.bot_id}:${body.operator_id}:${body.bot_public_key}:`.length);
  await appendOperation({
    type: "mint-bot",
    bot_id: body.bot_id,
    operator_id: body.operator_id,
    bot_public_key: body.bot_public_key,
    operator_signature: body.operator_signature,
    message: body.message,
    timestamp: timestamp || now,
  });
  return jsonResponse(201, record);
}

async function handlePostBotKeys(request: Request, botId: string): Promise<Response> {
  let body: AddKeySignedBody;
  try {
    body = validateAddKeySigned(await request.json(), botId);
  } catch (err) {
    return jsonError(400, "invalid_request", (err as Error).message);
  }

  const bot = await getBot(botId);
  if (!bot) {
    return jsonError(404, "not_found", "bot_id not found");
  }

  const operator = await getOperator(bot.operator_id);
  if (!operator) {
    return jsonError(400, "invalid_request", "operator not found");
  }
  const operatorPubKey = getOperatorActivePublicKey(operator);
  if (!operatorPubKey) {
    return jsonError(400, "invalid_request", "operator has no active public key");
  }

  const valid = await verifyEd25519(body.message, body.operator_signature, operatorPubKey);
  if (!valid) {
    return signatureInvalid("Operator signature verification failed");
  }

  const now = new Date().toISOString();
  const keyId = `${botId}-${now}`;
  const keyRecord: PublicKeyRecord = {
    key_id: keyId,
    algorithm: "ed25519",
    public_key: body.public_key,
    created: now,
    status: "active",
  };

  await addBotKey(botId, keyRecord);
  const timestamp = body.message.slice(`add-bot-key:${botId}:${body.public_key}:`.length);
  await appendOperation({
    type: "add-bot-key",
    bot_id: botId,
    public_key: body.public_key,
    operator_signature: body.operator_signature,
    message: body.message,
    timestamp: timestamp || now,
  });

  const updatedBot = await getBot(botId);
  return jsonResponse(201, updatedBot!);
}

async function handleGetBot(_request: Request, botId: string): Promise<Response> {
  const bot = await getBot(botId);
  if (!bot) {
    return jsonError(404, "not_found", "bot_id not found");
  }
  return jsonResponse(200, bot);
}

async function handleGetOperator(_request: Request, operatorId: string): Promise<Response> {
  const operator = await getOperator(operatorId);
  if (!operator) {
    return jsonError(404, "not_found", "operator_id not found");
  }
  return jsonResponse(200, operator);
}

function extractBotId(pathname: string): { botId: string | null; tail: string | null } {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "v1" || parts[1] !== "bots") {
    return { botId: null, tail: null };
  }
  const botId = decodeURIComponent(parts[2]);
  const tail = parts.slice(3).join("/");
  return { botId, tail: tail || null };
}

/** Extract operator_id from /v1/operators/:operator_id */
function extractOperatorId(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "v1" || parts[1] !== "operators") {
    return null;
  }
  return decodeURIComponent(parts[2]);
}

Bun.serve({
  port: Bun.env.IDENTITY_SERVICE_PORT ? Number(Bun.env.IDENTITY_SERVICE_PORT) : 8080,
  fetch: async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/v1/operators") {
      if (request.method === "POST") {
        return handlePostOperators(request);
      }
      return methodNotAllowed();
    }

    const operatorId = extractOperatorId(pathname);
    if (operatorId !== null) {
      if (request.method === "GET") {
        return handleGetOperator(request, operatorId);
      }
      return methodNotAllowed();
    }

    if (pathname === "/v1/bots" && request.method === "POST") {
      return handlePostBots(request);
    }

    if (pathname.startsWith("/v1/bots/")) {
      const { botId, tail } = extractBotId(pathname);
      if (!botId) return notFound();

      if (!tail) {
        if (request.method === "GET") {
          return handleGetBot(request, botId);
        }
        return methodNotAllowed();
      }

      if (tail === "keys") {
        if (request.method === "POST") {
          return handlePostBotKeys(request, botId);
        }
        return methodNotAllowed();
      }
    }

    return notFound();
  },
});

console.log(
  `Identity service listening on port ${
    Bun.env.IDENTITY_SERVICE_PORT ? Number(Bun.env.IDENTITY_SERVICE_PORT) : 8080
  }`,
);
