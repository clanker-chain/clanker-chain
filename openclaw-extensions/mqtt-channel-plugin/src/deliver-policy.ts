export type DeliverPayload = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  replyToId?: string;
  isNoReply?: boolean;
};

export type DeliverDecision =
  | { publish: true; text: string; replyToId?: string }
  | { publish: false; reason: string };

const NO_REPLY_LINE = /^\s*no_reply\s*$/i;

function isNoReplyTextMarker(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    return NO_REPLY_LINE.test(line);
  }
  return false;
}

function isNoReplyJsonWrapper(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return (parsed as Record<string, unknown>).isNoReply === true;
  } catch {
    return false;
  }
}

export function resolveDeliverDecision(payload: DeliverPayload): DeliverDecision {
  const text = payload.text ?? '';
  const media = [
    ...(payload.mediaUrls ?? []),
    ...(payload.mediaUrl ? [payload.mediaUrl] : []),
  ];
  const normalized = [text, ...media].filter(Boolean).join('\n');

  if (payload.isNoReply === true) {
    return { publish: false, reason: 'flag' };
  }

  if (isNoReplyTextMarker(text)) {
    return { publish: false, reason: 'no_reply_marker' };
  }

  if (isNoReplyJsonWrapper(text)) {
    return { publish: false, reason: 'json_wrapper' };
  }

  if (!normalized.trim()) {
    return { publish: false, reason: 'empty' };
  }

  return { publish: true, text: normalized, replyToId: payload.replyToId };
}
