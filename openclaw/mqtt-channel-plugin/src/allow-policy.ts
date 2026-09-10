/**
 * Client-side Policy helper (defense in depth — docs/trust-model.md).
 * Hub /acl is Transport; this drops after delivery if Policy still fails.
 *
 * Operator matching is by label string (same as channels.mqtt.operatorId /
 * envelope.operator_id). Hub ACL expands via on-chain operator ids.
 */

export type AllowPolicyInput = {
  /** Verified sender bot id (from_id) */
  senderBotId: string;
  /** Verified envelope operator_id (label) — bound by verifyMessage */
  senderOperatorLabel: string;
  /** Local account operator label */
  selfOperatorLabel: string;
  /** OpenClaw dmPolicy (`open` | `pairing` | …). `open` skips allow-list checks. */
  dmPolicy?: string | null;
  allowFrom?: Array<string | number> | null;
  allowOperators?: string[] | null;
};

/**
 * Allow if:
 * - dmPolicy is `open` (explicit open mesh — Transport still applies on the hub), or
 * - same operator as self, or
 * - sender bot id is in allowFrom, or
 * - sender operator label is in allowOperators
 *
 * When dmPolicy is unset / `pairing` (or anything other than `open`), empty
 * allowFrom + allowOperators ⇒ deny strangers.
 */
export function isSenderAllowed(input: AllowPolicyInput): boolean {
  const policy = (input.dmPolicy ?? "").trim().toLowerCase();
  if (policy === "open") {
    return true;
  }

  const senderOp = input.senderOperatorLabel.trim();
  const selfOp = input.selfOperatorLabel.trim();
  if (senderOp && selfOp && senderOp === selfOp) {
    return true;
  }

  const from = input.allowFrom ?? [];
  if (from.some((x) => String(x) === input.senderBotId)) {
    return true;
  }

  const ops = input.allowOperators ?? [];
  if (senderOp && ops.includes(senderOp)) {
    return true;
  }

  return false;
}
