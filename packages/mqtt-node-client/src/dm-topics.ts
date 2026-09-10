/**
 * Pair DM topic encoding (docs/bot-comms.md, docs/trust-model.md).
 * Segment is `sort(a,b).join("::")` — never `-`, because labels may contain hyphens (`*.prod-1`).
 */

const DM_SEP = "::";

/** Build sorted pair segment for `dm/{segment}/…`. Rejects labels containing `::`. */
export function dmPairSegment(bot1: string, bot2: string): string {
  const a = bot1.trim();
  const b = bot2.trim();
  if (!a || !b) throw new Error("dm pair requires two non-empty bot ids");
  if (a.includes(DM_SEP) || b.includes(DM_SEP)) {
    throw new Error(`bot ids must not contain "${DM_SEP}"`);
  }
  return [a, b].sort().join(DM_SEP);
}

/**
 * Parse `dm/{a}::{b}/…` where a and b are lexicographically sorted bot labels.
 * Returns null for malformed topics or legacy hyphen-joined segments.
 */
export function parseDmTopic(topic: string): { a: string; b: string } | null {
  const m = /^dm\/([^/]+)\/(.*)$/.exec(topic);
  if (!m) return null;
  const segment = m[1];
  const parts = segment.split(DM_SEP);
  if (parts.length !== 2) return null;
  const [left, right] = parts;
  if (!left || !right) return null;
  if ([left, right].sort().join(DM_SEP) !== segment) return null;
  return { a: left, b: right };
}

/** Topic for private coordination between two bots (canonical bot ids). */
export function topicForDmCoordination(bot1: string, bot2: string): string {
  return `dm/${dmPairSegment(bot1, bot2)}/coordination`;
}
