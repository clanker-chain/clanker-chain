/**
 * Persist Privy OAuth tokens (never operator hex, never ephemeral auth keys).
 * Prefer macOS Keychain; fall back to mode-0600 ~/.clanker/privy-session.json.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { clankerHome } from "./profile.mjs";

const KEYCHAIN_SERVICE = "clanker-privy-session";
const KEYCHAIN_ACCOUNT = "default";

/**
 * @param {string} [home]
 */
export function privySessionPath(home = clankerHome()) {
  return join(home, "privy-session.json");
}

/**
 * @typedef {{
 *   appId: string,
 *   accessToken: string,
 *   refreshToken: string,
 *   expiresAt: number,
 *   walletId: string,
 *   address: string,
 *   createdAt: number,
 * }} PrivySession
 */

/**
 * @param {string} [home]
 * @returns {PrivySession|null}
 */
export function loadPrivySession(home = clankerHome()) {
  const fromKeychain = loadFromKeychain();
  if (fromKeychain) return fromKeychain;
  const path = privySessionPath(home);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!raw?.accessToken || !raw?.refreshToken || !raw?.walletId || !raw?.address) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * @param {PrivySession} session
 * @param {string} [home]
 */
export function savePrivySession(session, home = clankerHome()) {
  const payload = JSON.stringify(session);
  if (saveToKeychain(payload)) {
    // Prefer keychain; remove file copy if present.
    const path = privySessionPath(home);
    if (existsSync(path)) {
      try {
        rmSync(path);
      } catch {
        /* ignore */
      }
    }
    return { storage: "keychain" };
  }
  mkdirSync(home, { recursive: true });
  const path = privySessionPath(home);
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  return { storage: "file", path };
}

/**
 * @param {string} [home]
 */
export function clearPrivySession(home = clankerHome()) {
  clearKeychain();
  const path = privySessionPath(home);
  if (existsSync(path)) {
    rmSync(path);
  }
}

/**
 * @returns {PrivySession|null}
 */
function loadFromKeychain() {
  if (process.platform !== "darwin") return null;
  const out = spawnSync(
    "security",
    [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
    ],
    { encoding: "utf8" },
  );
  if (out.status !== 0) return null;
  try {
    const raw = JSON.parse(String(out.stdout || "").trim());
    if (!raw?.accessToken || !raw?.refreshToken) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * @param {string} payload
 */
function saveToKeychain(payload) {
  if (process.platform !== "darwin") return false;
  clearKeychain();
  const out = spawnSync(
    "security",
    [
      "add-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
      payload,
      "-U",
    ],
    { encoding: "utf8" },
  );
  return out.status === 0;
}

function clearKeychain() {
  if (process.platform !== "darwin") return;
  spawnSync(
    "security",
    [
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
    ],
    { encoding: "utf8", stdio: "ignore" },
  );
}
