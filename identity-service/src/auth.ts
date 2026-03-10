/** Returns 403 response for invalid or missing signature (auth-free mint flow). */
export function signatureInvalid(message = "Invalid or missing signature"): Response {
  return jsonError(403, "forbidden", message);
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

