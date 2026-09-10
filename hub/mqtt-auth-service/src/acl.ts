/**
 * Transport ACL decisions (docs/trust-model.md).
 * Mosquitto go-auth POST /acl: { username, clientid, topic, acc }
 * acc: 1=read, 2=write, 3=readwrite, 4=subscribe
 *
 * Pair DM topics use `dm/{a}::{b}/…` (shared with mqtt-node-client).
 */

import { keccak256, toBytes, type Hex } from "viem";
import type { RegistryClient } from "@clanker-chain/identity-node-client";
import { dmPairSegment, parseDmTopic } from "@clanker-chain/mqtt-node-client";
import type { PairingStore } from "./pairing-store.js";

export type Acc = 1 | 2 | 3 | 4 | number;

export interface AclRequest {
  username: string;
  topic: string;
  acc: Acc;
  clientid?: string;
}

export interface AclDecision {
  ok: boolean;
  reason: string;
}

function labelToId(label: string): Hex {
  return keccak256(toBytes(label)) as Hex;
}

function isSubscribe(acc: Acc): boolean {
  return acc === 1 || acc === 3 || acc === 4;
}

function isPublish(acc: Acc): boolean {
  return acc === 2 || acc === 3;
}

export { dmPairSegment, parseDmTopic };

export async function evaluateAcl(
  req: AclRequest,
  registry: RegistryClient,
  pairing: PairingStore,
): Promise<AclDecision> {
  const username = req.username?.trim();
  const topic = req.topic?.trim();
  if (!username || !topic) {
    return { ok: false, reason: "missing_fields" };
  }

  let bot;
  try {
    bot = await registry.getBotByLabel(username);
  } catch {
    return { ok: false, reason: "registry_unavailable" };
  }
  if (!bot || bot.status !== "active") {
    return { ok: false, reason: "bot_not_active" };
  }

  let operator;
  try {
    operator = await registry.getOperatorById(bot.operatorId);
  } catch {
    return { ok: false, reason: "registry_unavailable" };
  }
  if (!operator || operator.status !== "active") {
    return { ok: false, reason: "operator_not_active" };
  }

  const sub = isSubscribe(req.acc);
  const pub = isPublish(req.acc);

  // Own status publish
  if (pub && topic === `bots/${username}/status`) {
    return { ok: true, reason: "own_status" };
  }

  // Own inbox subscribe
  if (sub && topic === `bots/${username}/inbox`) {
    return { ok: true, reason: "own_inbox" };
  }

  // Own tree subscribe (bots/{username}/#)
  if (sub && (topic === `bots/${username}/#` || topic.startsWith(`bots/${username}/`))) {
    return { ok: true, reason: "own_tree" };
  }

  // Announce subscribe (documented Transport exception)
  if (sub && topic === "bots/all/announce") {
    return { ok: true, reason: "announce_sub" };
  }

  // Announce publish denied in v1
  if (pub && topic === "bots/all/announce") {
    return { ok: false, reason: "announce_pub_denied" };
  }

  // Peer inbox publish: bots/{peer}/inbox
  const inboxMatch = /^bots\/([^/]+)\/inbox$/.exec(topic);
  if (pub && inboxMatch) {
    const peer = inboxMatch[1];
    if (peer === username) {
      return { ok: true, reason: "own_inbox_pub" };
    }
    let peerBot;
    try {
      peerBot = await registry.getBotByLabel(peer);
    } catch {
      return { ok: false, reason: "registry_unavailable" };
    }
    if (!peerBot || peerBot.status !== "active") {
      return { ok: false, reason: "peer_not_active" };
    }
    // Same operator always allowed
    if (peerBot.operatorId.toLowerCase() === bot.operatorId.toLowerCase()) {
      return { ok: true, reason: "same_operator" };
    }
    // Peer's operator must allow-list sender's operator (or sender bot id)
    if (
      pairing.allowsOperator(peerBot.operatorId, bot.operatorId) ||
      pairing.allowsBot(peerBot.operatorId, username)
    ) {
      return { ok: true, reason: "peer_allows_sender" };
    }
    return { ok: false, reason: "not_paired" };
  }

  // DM pair topics: dm/{a}::{b}/…
  const dm = parseDmTopic(topic);
  if (dm && (sub || pub)) {
    if (username !== dm.a && username !== dm.b) {
      return { ok: false, reason: "dm_not_participant" };
    }
    const other = username === dm.a ? dm.b : dm.a;
    let otherBot;
    try {
      otherBot = await registry.getBotByLabel(other);
    } catch {
      return { ok: false, reason: "registry_unavailable" };
    }
    if (!otherBot || otherBot.status !== "active") {
      return { ok: false, reason: "peer_not_active" };
    }
    if (otherBot.operatorId.toLowerCase() === bot.operatorId.toLowerCase()) {
      return { ok: true, reason: "dm_same_operator" };
    }
    if (pairing.isMutual(bot.operatorId, otherBot.operatorId)) {
      return { ok: true, reason: "dm_mutual" };
    }
    return { ok: false, reason: "dm_not_mutual" };
  }

  return { ok: false, reason: "denied" };
}

export { labelToId };
