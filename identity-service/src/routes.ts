import { jsonError, jsonResponse } from "./auth";
import type { IdentityBackend } from "./backend";

function notFound(): Response {
  return jsonError(404, "not_found", "Route not found");
}

function methodNotAllowed(): Response {
  return jsonError(405, "method_not_allowed", "Method not allowed");
}

async function handleGetBot(backend: IdentityBackend, botId: string): Promise<Response> {
  const bot = await backend.getBot(botId);
  if (!bot) {
    return jsonError(404, "not_found", "bot_id not found");
  }
  return jsonResponse(200, bot);
}

async function handleGetOperator(backend: IdentityBackend, operatorId: string): Promise<Response> {
  const operator = await backend.getOperator(operatorId);
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

function extractOperatorId(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "v1" || parts[1] !== "operators") {
    return null;
  }
  return decodeURIComponent(parts[2]);
}

export function createFetchHandler(backend: IdentityBackend) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/health" || pathname === "/health/") {
      if (request.method === "GET") {
        return jsonResponse(200, await backend.health());
      }
      return methodNotAllowed();
    }

    const operatorId = extractOperatorId(pathname);
    if (operatorId !== null) {
      if (request.method === "GET") {
        return handleGetOperator(backend, operatorId);
      }
      return methodNotAllowed();
    }

    if (pathname.startsWith("/v1/bots/")) {
      const { botId, tail } = extractBotId(pathname);
      if (!botId) return notFound();
      if (!tail) {
        if (request.method === "GET") {
          return handleGetBot(backend, botId);
        }
        return methodNotAllowed();
      }
    }

    return notFound();
  };
}
