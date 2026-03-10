export function requireAdmin(request: Request): Response | null {
  const adminToken = Bun.env.IDENTITY_ADMIN_TOKEN;
  if (!adminToken) {
    // If no token is configured, treat all requests as unauthorized for safety.
    return jsonError(500, "server_misconfigured", "IDENTITY_ADMIN_TOKEN is not set");
  }

  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return jsonError(401, "unauthorized", "Missing or invalid Authorization header");
  }

  const token = header.slice("bearer ".length).trim();
  if (token !== adminToken) {
    return jsonError(403, "forbidden", "Invalid admin token");
  }
  return null;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function jsonError(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: code, message });
}

