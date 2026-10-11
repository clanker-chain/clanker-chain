/**
 * Persist Privy OAuth tokens (never operator hex, never ephemeral auth keys).
 * Prefer macOS Keychain; fall back to mode-0600 ~/.clanker/privy-session.json.
 *
 * Keychain items are scoped per resolved CLANKER_HOME so a sandbox profile
 * cannot pick up (or wipe) the default ~/.clanker session.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { clankerHome } from "./profile.mjs";

export const KEYCHAIN_SERVICE = "clanker-privy-session";

/**
 * Default on-disk home (ignores CLANKER_HOME). Used to keep the existing
 * Keychain account name (`default`) for the real profile.
 */
export function defaultClankerHome() {
  return join(homedir(), ".clanker");
}

/**
 * Keychain account for this profile home. `default` for ~/.clanker; a short
 * hash otherwise so sandboxes do not share the production grant.
 *
 * @param {string} [home]
 */
export function privyKeychainAccount(home = clankerHome()) {
  const resolved = resolve(home);
  if (resolved === resolve(defaultClankerHome())) return "default";
  return createHash("sha256").update(resolved).digest("hex").slice(0, 16);
}

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
 * @returns {"keychain"|"file"|null}
 */
export function locatePrivySession(home = clankerHome()) {
  if (loadFromKeychain(home)) return "keychain";
  if (existsSync(privySessionPath(home))) return "file";
  return null;
}

/**
 * @param {string} [home]
 * @returns {PrivySession|null}
 */
export function loadPrivySession(home = clankerHome()) {
  const fromKeychain = loadFromKeychain(home);
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
  if (saveToKeychain(payload, home)) {
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
  clearKeychain(home);
  const path = privySessionPath(home);
  if (existsSync(path)) {
    rmSync(path);
  }
}

/**
 * @param {string} [home]
 * @returns {PrivySession|null}
 */
function loadFromKeychain(home) {
  if (process.platform !== "darwin") return null;
  const out = spawnSync(
    "security",
    [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      privyKeychainAccount(home),
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
 * @param {string} [home]
 */
function saveToKeychain(payload, home) {
  if (process.platform !== "darwin") return false;
  clearKeychain(home);
  const out = spawnSync(
    "security",
    [
      "add-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      privyKeychainAccount(home),
      "-w",
      payload,
      "-U",
    ],
    { encoding: "utf8" },
  );
  return out.status === 0;
}

/**
 * @param {string} [home]
 */
function clearKeychain(home) {
  if (process.platform !== "darwin") return;
  spawnSync(
    "security",
    [
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      privyKeychainAccount(home),
    ],
    { encoding: "utf8", stdio: "ignore" },
  );
}
