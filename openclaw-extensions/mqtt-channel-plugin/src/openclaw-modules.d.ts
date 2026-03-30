/**
 * Minimal typings so this package typechecks without installing OpenClaw locally.
 * At runtime, OpenClaw provides these modules (>= 2026.3.22).
 */
declare module 'openclaw/plugin-sdk/core' {
  export type OpenClawConfig = Record<string, unknown>;

  export type DefinedChannelPluginEntry<TPlugin = unknown> = {
    id: string;
    name: string;
    description: string;
    configSchema: unknown;
    register: (api: unknown) => void;
    channelPlugin: TPlugin;
    setChannelRuntime?: (runtime: unknown) => void;
  };

  export function defineChannelPluginEntry<TPlugin>(options: {
    id: string;
    name: string;
    description: string;
    plugin: TPlugin;
    configSchema?: unknown | (() => unknown);
    setRuntime?: (runtime: unknown) => void;
    registerFull?: (api: unknown) => void;
  }): DefinedChannelPluginEntry<TPlugin>;

  export function defineSetupPluginEntry<TPlugin>(plugin: TPlugin): { plugin: TPlugin };

  export function createChannelPluginBase<TResolvedAccount>(params: unknown): Record<string, unknown>;

  export function createChatChannelPlugin<TResolvedAccount extends { accountId?: string | null }>(
    params: unknown,
  ): unknown;

  export type ChannelGatewayContext<ResolvedAccount = unknown> = {
    cfg: OpenClawConfig;
    accountId: string;
    account: ResolvedAccount;
    runtime: unknown;
    abortSignal: AbortSignal;
    log?: {
      info?: (msg: string) => void;
      warn?: (msg: string) => void;
      error?: (msg: string) => void;
    };
    getStatus: () => unknown;
    setStatus: (next: unknown) => void;
    channelRuntime?: ChannelRuntime;
  };

  export type OutboundDeliveryResult = {
    channel?: string;
    messageId: string;
    chatId?: string;
    meta?: Record<string, unknown>;
  };

  export type ChannelOutboundContext = {
    cfg: OpenClawConfig;
    accountId?: string | null;
    to: string;
    text: string;
  };

  /** Subset of PluginRuntime["channel"] used by this plugin */
  export type ChannelRuntime = {
    routing: {
      resolveAgentRoute: (input: {
        cfg: OpenClawConfig;
        channel: string;
        accountId?: string | null;
        peer?: { kind: string; id: string } | null;
      }) => {
        agentId: string;
        sessionKey: string;
        mainSessionKey: string;
        accountId: string;
      };
    };
    reply: {
      finalizeInboundContext: <T extends Record<string, unknown>>(
        ctx: T,
        opts?: unknown,
      ) => T & Record<string, unknown>;
      dispatchReplyWithBufferedBlockDispatcher: (params: {
        ctx: Record<string, unknown>;
        cfg: OpenClawConfig;
        dispatcherOptions: {
          deliver: (
            payload: { text?: string; mediaUrl?: string; mediaUrls?: string[]; replyToId?: string },
            info: { kind: string },
          ) => Promise<void>;
          onError?: (err: unknown, info: { kind: string }) => void;
        };
        replyOptions?: unknown;
      }) => Promise<unknown>;
    };
    session: {
      recordSessionMetaFromInbound?: (params: unknown) => Promise<void>;
    };
  };
}

declare module 'openclaw/plugin-sdk/channel-inbound' {
  import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';

  export function dispatchInboundDirectDmWithRuntime(params: {
    cfg: OpenClawConfig;
    /** Must provide `channel` matching PluginRuntime["channel"] */
    runtime: { channel: unknown };
    channel: string;
    channelLabel: string;
    accountId: string;
    peer: { kind: 'direct'; id: string };
    senderId: string;
    senderAddress: string;
    recipientAddress: string;
    conversationLabel: string;
    rawBody: string;
    messageId: string;
    timestamp?: number;
    deliver: (payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string; replyToId?: string }) => Promise<void>;
    onRecordError: (err: unknown) => void;
    onDispatchError: (err: unknown, info: { kind: string }) => void;
  }): Promise<unknown>;
}
