/**
 * Public Privy app id for device-authorization (no app secret).
 * Override with PRIVY_APP_ID. Same production app as /join + /authorize.
 */

/** Production clanker-chain.com Privy app (public). */
export const DEFAULT_PRIVY_APP_ID = "cmtyejsb100ok0ckz9ldfvakw";

export const PRIVY_AUTH_BASE = "https://auth.privy.io";

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolvePrivyAppId(env = process.env) {
  const id = (env.PRIVY_APP_ID || DEFAULT_PRIVY_APP_ID || "").trim();
  if (!id) {
    throw new Error("PRIVY_APP_ID is empty");
  }
  return id;
}
