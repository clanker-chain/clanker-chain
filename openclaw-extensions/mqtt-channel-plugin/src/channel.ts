import { dispatchInboundDirectDmWithRuntime } from 'openclaw/plugin-sdk/channel-inbound';
import {
  createChannelPluginBase,
  createChatChannelPlugin,
  type ChannelGatewayContext,
  type ChannelOutboundContext,
  type OpenClawConfig,
} from 'openclaw/plugin-sdk/core';
import {
  listMqttAccountIds,
  mqttAccountToChannelConfig,
  resolveMqttAccount,
  type ResolvedMqttAccount,
} from './accounts.js';
import { MqttChannelProvider } from './MqttChannelProvider.js';
import type { InboundMessage } from './types.js';

const providers = new Map<string, MqttChannelProvider>();

function stripMqttTarget(raw: string): string {
  const t = raw.trim();
  if (t.toLowerCase().startsWith('mqtt:')) {
    return t.slice('mqtt:'.length);
  }
  return t;
}

async function dispatchDirectInbound(params: {
  ctx: ChannelGatewayContext<ResolvedMqttAccount>;
  provider: MqttChannelProvider;
  inbound: InboundMessage;
}): Promise<void> {
  const { ctx, provider, inbound } = params;
  const rt = ctx.channelRuntime;
  if (!rt) {
    ctx.log?.warn?.('[mqtt-channel] channelRuntime missing; cannot dispatch inbound (upgrade OpenClaw)');
    return;
  }

  await dispatchInboundDirectDmWithRuntime({
    cfg: ctx.cfg,
    runtime: { channel: rt },
    channel: 'mqtt',
    channelLabel: 'MQTT',
    accountId: ctx.accountId,
    peer: { kind: 'direct', id: inbound.from },
    senderId: inbound.from,
    senderAddress: `mqtt:${inbound.from}`,
    recipientAddress: `mqtt:${ctx.account.botId}`,
    conversationLabel: inbound.from,
    rawBody: inbound.text,
    messageId: inbound.id,
    deliver: async (payload) => {
      const text = payload.text ?? '';
      if (!text.trim()) {
        return;
      }
      await provider.sendMessage({
        to: inbound.from,
        text,
        replyTo: payload.replyToId,
      });
    },
    onRecordError: (err) => ctx.log?.error?.(`[mqtt-channel] record error: ${String(err)}`),
    onDispatchError: (err, info) =>
      ctx.log?.error?.(`[mqtt-channel] dispatch error (${info.kind}): ${String(err)}`),
  });
}

async function dispatchGroupInbound(params: {
  ctx: ChannelGatewayContext<ResolvedMqttAccount>;
  provider: MqttChannelProvider;
  inbound: InboundMessage;
}): Promise<void> {
  const rt = params.ctx.channelRuntime;
  if (!rt) {
    params.ctx.log?.warn?.('[mqtt-channel] channelRuntime missing; cannot dispatch group inbound');
    return;
  }

  const route = rt.routing.resolveAgentRoute({
    cfg: params.ctx.cfg,
    channel: 'mqtt',
    accountId: params.ctx.accountId,
    peer: { kind: 'group', id: 'announce' },
  });

  const baseCtx: Record<string, unknown> = {
    Body: params.inbound.text,
    RawBody: params.inbound.text,
    CommandBody: params.inbound.text,
    From: `mqtt:${params.inbound.from}`,
    To: `mqtt:announce`,
    SessionKey: route.sessionKey,
    AccountId: params.ctx.accountId,
    ChatType: 'group',
    ConversationLabel: 'MQTT announce',
    Provider: 'mqtt',
    Surface: 'mqtt',
    MessageSid: params.inbound.id,
    MessageSidFull: params.inbound.id,
    SenderId: params.inbound.from,
  };

  const finalized = rt.reply.finalizeInboundContext(baseCtx);

  await rt.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: finalized,
    cfg: params.ctx.cfg,
    dispatcherOptions: {
      deliver: async (payload, info) => {
        void info;
        const text = [payload.text, ...(payload.mediaUrls ?? [])].filter(Boolean).join('\n');
        if (!text.trim()) {
          return;
        }
        await params.provider.publishJson(params.provider.getAnnounceTopic(), {
          from: params.ctx.account.botId,
          timestamp: new Date().toISOString(),
          body: text,
          replyTo: params.inbound.id,
          kind: 'announce-reply',
        });
      },
      onError: (err, info) =>
        params.ctx.log?.error?.(`[mqtt-channel] group reply failed (${info.kind}): ${String(err)}`),
    },
  });
}

const basePlugin = createChannelPluginBase({
  id: 'mqtt',
  meta: {
    id: 'mqtt',
    label: 'MQTT',
    selectionLabel: 'MQTT',
    docsPath: '/channels/mqtt',
    blurb: 'Connect OpenClaw to MQTT for bot-to-bot messaging.',
    markdownCapable: true,
    quickstartAllowFrom: true,
  },
  capabilities: {
    chatTypes: ['direct', 'group'],
    reply: true,
  },
  config: {
    listAccountIds: listMqttAccountIds,
    resolveAccount: resolveMqttAccount,
    defaultAccountId: (cfg: OpenClawConfig) => listMqttAccountIds(cfg)[0] ?? 'default',
    isEnabled: (account: ResolvedMqttAccount) => account.userEnabled && account.configured,
    isConfigured: (account: ResolvedMqttAccount) => account.configured,
    inspectAccount: (cfg: OpenClawConfig, accountId?: string | null) => {
      const a = resolveMqttAccount(cfg, accountId);
      return {
        accountId: a.accountId,
        userEnabled: a.userEnabled,
        configured: a.configured,
        running: providers.has(a.accountId),
      };
    },
  },
  setup: {
    applyAccountConfig: ({
      cfg,
      accountId,
      input,
    }: {
      cfg: OpenClawConfig;
      accountId: string;
      input: unknown;
    }) => {
      const c = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>;
      const channels = (c.channels ??= {}) as Record<string, unknown>;
      const mqtt = (channels.mqtt ??= {}) as Record<string, unknown>;
      const acc = accountId || 'default';
      const patch = input as Record<string, unknown>;
      if (mqtt.accounts && typeof mqtt.accounts === 'object' && !Array.isArray(mqtt.accounts)) {
        const accounts = { ...(mqtt.accounts as Record<string, unknown>) };
        const prev = (accounts[acc] as Record<string, unknown> | undefined) ?? {};
        accounts[acc] = { ...prev, ...patch };
        mqtt.accounts = accounts;
      } else if (acc !== 'default') {
        mqtt.accounts = { [acc]: { ...patch } };
      } else {
        Object.assign(mqtt, patch);
      }
      return c as OpenClawConfig;
    },
  },
}) as Record<string, unknown>;

export const mqttChannelPlugin = createChatChannelPlugin({
  base: {
    ...basePlugin,
    gateway: {
      startAccount: async (ctx: ChannelGatewayContext<ResolvedMqttAccount>) => {
        const account = ctx.account;
        if (!account.userEnabled || !account.configured) {
          ctx.log?.info?.(`[mqtt-channel] skip start for ${ctx.accountId} (disabled or not configured)`);
          return;
        }
        if (providers.has(ctx.accountId)) {
          ctx.log?.warn?.(`[mqtt-channel] provider already running for ${ctx.accountId}`);
          return;
        }
        const provider = new MqttChannelProvider(mqttAccountToChannelConfig(account));
        providers.set(ctx.accountId, provider);

        provider.onMessage(async (inbound) => {
          try {
            if (ctx.abortSignal.aborted) {
              return;
            }
            if (inbound.chatType === 'direct') {
              await dispatchDirectInbound({ ctx, provider, inbound });
            } else {
              await dispatchGroupInbound({ ctx, provider, inbound });
            }
          } catch (e) {
            ctx.log?.error?.(`[mqtt-channel] inbound error: ${String(e)}`);
          }
        });

        ctx.log?.info?.(`[mqtt-channel] starting account ${ctx.accountId}`);
        try {
          await provider.runUntilAborted(ctx.abortSignal);
        } catch (e) {
          providers.delete(ctx.accountId);
          throw e;
        }
        ctx.log?.info?.(`[mqtt-channel] runUntilAborted returned for ${ctx.accountId}`);
      },
      stopAccount: async (ctx: ChannelGatewayContext<ResolvedMqttAccount>) => {
        const p = providers.get(ctx.accountId);
        if (p) {
          await p.stop();
          providers.delete(ctx.accountId);
        }
        ctx.log?.info?.(`[mqtt-channel] stopped account ${ctx.accountId}`);
      },
    },
  },
  security: {
    dm: {
      channelKey: 'mqtt',
      resolvePolicy: (account: ResolvedMqttAccount) => account.dmPolicy ?? null,
      resolveAllowFrom: (account: ResolvedMqttAccount) => account.allowFrom ?? null,
    },
  },
  threading: {
    topLevelReplyToMode: 'reply',
  },
  outbound: {
    base: {},
    attachedResults: {
      channel: 'mqtt',
      sendText: async (ctx: ChannelOutboundContext) => {
        const aid = ctx.accountId ?? 'default';
        const provider = providers.get(aid);
        if (!provider) {
          throw new Error(
            `MQTT channel is not connected (account "${aid}"). Is the gateway running?`,
          );
        }
        const to = stripMqttTarget(ctx.to);
        await provider.sendMessage({ to, text: ctx.text });
        return { messageId: `mqtt-${Date.now()}` };
      },
    },
  },
});
