/**
 * Shared human-path CLI UX (color, plans, next hints, structured errors).
 * Respects NO_COLOR / non-TTY via picocolors.
 */

import pc from "picocolors";
import * as clack from "@clack/prompts";

export const c = {
  dim: (s) => pc.dim(String(s)),
  green: (s) => pc.green(String(s)),
  yellow: (s) => pc.yellow(String(s)),
  red: (s) => pc.red(String(s)),
  bold: (s) => pc.bold(String(s)),
  cyan: (s) => pc.cyan(String(s)),
};

/**
 * @param {string[]} argv
 * @param {{ stdinTTY?: boolean }} [opts]
 */
export function isInteractive(argv = [], opts = {}) {
  const tty = opts.stdinTTY ?? Boolean(process.stdin.isTTY);
  if (!tty) return false;
  if (argv.includes("--yes") || argv.includes("-y")) return false;
  if (argv.includes("--json")) return false;
  return true;
}

/**
 * @param {string|string[]} lines
 */
export function nextHint(lines) {
  const list = Array.isArray(lines) ? lines : [lines];
  console.log("");
  console.log(c.bold("Next:"));
  for (const line of list) {
    console.log(`  ${c.cyan(line)}`);
  }
}

/**
 * Cargo-style human error.
 * @param {{ error: string, because?: string, try?: string[] }} opts
 * @returns {string}
 */
export function formatCliError(opts) {
  const lines = [c.red(`error: ${opts.error}`)];
  if (opts.because) {
    lines.push(c.dim(`because: ${opts.because}`));
  }
  if (opts.try?.length) {
    lines.push(c.yellow("try:"));
    for (const t of opts.try) {
      lines.push(`  ${t}`);
    }
  }
  return lines.join("\n");
}

/**
 * Print a plan table (key/value rows).
 * @param {[string, string][]} rows
 * @param {string} [title]
 */
export function printPlan(rows, title = "Plan") {
  console.log("");
  console.log(c.bold(title));
  const w = Math.min(18, Math.max(4, ...rows.map(([k]) => k.length)));
  for (const [k, v] of rows) {
    const pad = k + " ".repeat(Math.max(0, w - k.length));
    console.log(`  ${c.dim(pad)}  ${v}`);
  }
}

/**
 * Confirm a mutating plan. Skips when not interactive.
 * @param {string[]} argv
 * @param {[string, string][]} rows
 * @param {string} [message]
 * @returns {Promise<boolean>}
 */
export async function confirmPlan(argv, rows, message = "Proceed?") {
  printPlan(rows);
  if (!isInteractive(argv)) return true;
  const ok = await clack.confirm({
    message,
    initialValue: true,
  });
  if (clack.isCancel(ok) || ok === false) {
    clack.cancel("Aborted.");
    return false;
  }
  return true;
}

/**
 * Print structured error to stderr and exit.
 * @param {{ error: string, because?: string, try?: string[], status?: number }} opts
 */
export function exitCliError(opts) {
  console.error(formatCliError(opts));
  process.exit(opts.status ?? 1);
}
