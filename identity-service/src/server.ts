import { jsonError, jsonResponse, requireAdmin } from "./auth";
import {
  addBotKey,
  getBot,
  getLedgerSnapshot,
  loadLedger,
  type BotRecord,
  type OperatorRecord,
  type PublicKeyRecord,
  upsertBot,
  upsertOperator,
} from "./ledger";
import {
  type AddKeyBody,
  type CreateBotBody,
  type CreateOperatorBody,
  validateAddKey,
  validateCreateBot,
  validateCreateOperator,
} from "./validation";

// Ensure ledger is loaded on startup
void loadLedger();

function notFound(): Response {
  return jsonError(404, "not_found", "Route not found");
}

function methodNotAllowed(): Response {
  return jsonError(405, "method_not_allowed", "Method not allowed");
}

async function handlePostOperators(request: Request): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  let body: CreateOperatorBody;
  try {
    const json = await request.json();
    body = validateCreateOperator(json);
  } catch (err) {
    return jsonError(400, "invalid_request", (err as Error).message);
  }

  const ledger = await getLedgerSnapshot();
  if (ledger.operators[body.operator_id]) {
    return jsonError(409, "conflict", "operator_id already exists");
  }

  const now = new Date().toISOString();
  const record: OperatorRecord = {
    operator_id: body.operator_id,
    display_name: body.display_name,
    public_keys: body.public_keys,
    status: "active",
    created: now,
    updated: now,
  };

  await upsertOperator(record);
  return jsonResponse(201, record);
}

async function handlePostBots(request: Request): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  let body: CreateBotBody;
  try {
    const ledger = await getLedgerSnapshot();
    const validated = validateCreateBot(request.json ? await request.json() : {}, ledger.operators, ledger.bots);
    body = validated;
  } catch (err) {
    return jsonError(400, "invalid_request", (err as Error).message);
  }

  const now = new Date().toISOString();
  const record: BotRecord = {
    bot_id: body.bot_id,
    display_name: body.display_name,
    operator_id: body.operator_id,
    aliases: body.aliases,
    public_keys: [],
    status: "active",
    created: now,
    updated: now,
    metadata: body.metadata,
  };

  try {
    await upsertBot(record);
  } catch (err) {
    return jsonError(500, "internal_error", (err as Error).message);
  }

  return jsonResponse(201, record);
}

async function handlePostBotKeys(request: Request, botId: string): Promise<Response> {
  const authError = requireAdmin(request);
  if (authError) return authError;

  let body: AddKeyBody;
  try {
    body = validateAddKey(await request.json());
  } catch (err) {
    return jsonError(400, "invalid_request", (err as Error).message);
  }

  const bot = await getBot(botId);
  if (!bot) {
    return jsonError(404, "not_found", "bot_id not found");
  }

  const now = new Date().toISOString();
  const keyId = body.key_id ?? `${botId}-${now}`;
  const keyRecord: PublicKeyRecord = {
    key_id: keyId,
    algorithm: body.algorithm,
    public_key: body.public_key,
    created: now,
    status: "active",
    metadata: body.metadata,
  };

  try {
    await addBotKey(botId, keyRecord);
  } catch (err) {
    return jsonError(500, "internal_error", (err as Error).message);
  }

  const updatedBot = await getBot(botId);
  return jsonResponse(201, updatedBot);
}

async function handleGetBot(_request: Request, botId: string): Promise<Response> {
  const bot = await getBot(botId);
  if (!bot) {
    return jsonError(404, "not_found", "bot_id not found");
  }
  return jsonResponse(200, bot);
}

function extractBotId(pathname: string): { botId: string | null; tail: string | null } {
  // Expect paths like /v1/bots/{bot_id} or /v1/bots/{bot_id}/keys
  const parts = pathname.split("/").filter(Boolean); // remove empty segments
  if (parts.length < 3 || parts[0] !== "v1" || parts[1] !== "bots") {
    return { botId: null, tail: null };
  }
  const botId = decodeURIComponent(parts[2]);
  const tail = parts.slice(3).join("/");
  return { botId, tail: tail || null };
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

