/**
 * Dual-write bot keys to ~/.openclaw/keys and ~/.clanker/keys.
 */

import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clankerKeysDir, openclawKeysDir } from "./profile.mjs";

/**
 * Reject labels that are unsafe as a single path segment.
 * @param {string} label
 */
export function assertSafeBotLabel(label) {
  const s = String(label ?? "");
  if (!s) {
    throw new Error("Bot label must be non-empty");
  }
  if (s.includes("\0")) {
    throw new Error("Bot label must not contain NUL");
  }
  if (s.includes("/") || s.includes("\\")) {
    throw new Error("Bot label must not contain path separators");
  }
  if (s === "." || s === ".." || s.includes("..")) {
    throw new Error('Bot label must not contain ".."');
  }
}

/**
 * Write bot private key before broadcasting registerBot.
 * Primary path remains ~/.openclaw/keys for published plugins.
 * Also writes (or symlinks) under ~/.clanker/keys (or CLANKER_KEY_DIR).
 *
 * @param {string} botLabel
 * @param {string} botPrivateKey
 * @param {{ env?: NodeJS.ProcessEnv, openclawKeysDir?: string, clankerKeysDir?: string }} [opts]
 * @returns {{ openclawPath: string, clankerPath: string }}
 */
export function writeBotKeyFiles(botLabel, botPrivateKey, opts = {}) {
  assertSafeBotLabel(botLabel);
  const env = opts.env ?? process.env;
  const openclawDir = opts.openclawKeysDir ?? openclawKeysDir();
  const clankerDir = opts.clankerKeysDir ?? clankerKeysDir(env);

  mkdirSync(openclawDir, { recursive: true });
  mkdirSync(clankerDir, { recursive: true });

  const openclawPath = join(openclawDir, `${botLabel}.key`);
  const clankerPath = join(clankerDir, `${botLabel}.key`);

  if (existsSync(openclawPath)) {
    throw new Error(
      `Key file already exists at ${openclawPath}; refusing to overwrite. ` +
        `Remove it or choose a different bot label.`,
    );
  }
  if (existsSync(clankerPath)) {
    throw new Error(
      `Key file already exists at ${clankerPath}; refusing to overwrite. ` +
        `Remove it or choose a different bot label.`,
    );
  }

  const body = `${botPrivateKey}\n`;
  writeFileSync(openclawPath, body, { flag: "wx", mode: 0o600 });

  try {
    symlinkSync(openclawPath, clankerPath);
  } catch {
    // Symlink may fail on some FS; fall back to a second copy.
    writeFileSync(clankerPath, body, { flag: "wx", mode: 0o600 });
  }

  return { openclawPath, clankerPath };
}
