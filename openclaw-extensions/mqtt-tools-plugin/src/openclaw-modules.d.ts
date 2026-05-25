/**
 * Minimal typings so this package typechecks without installing OpenClaw locally.
 * At runtime, OpenClaw provides these modules (>= 2026.5.17 for tool plugins).
 */
declare module "openclaw/plugin-sdk/plugin-entry" {
  export type OpenClawConfig = Record<string, unknown>;

  export type OpenClawPluginApi = {
    config: OpenClawConfig;
    registerTool: (tool: AgentToolDefinition, opts?: { optional?: boolean }) => void;
    logger?: {
      info?: (msg: string) => void;
      warn?: (msg: string) => void;
      error?: (msg: string) => void;
    };
  };

  export type AgentToolDefinition = {
    name: string;
    description: string;
    parameters: unknown;
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      ctx?: ToolExecuteContext,
    ) => Promise<unknown>;
  };

  export type ToolExecuteContext = {
    signal?: AbortSignal;
    /** Full gateway config when provided by the host runtime */
    openclawConfig?: OpenClawConfig;
    config?: OpenClawConfig;
  };

  export function definePluginEntry(options: {
    id: string;
    name: string;
    description: string;
    configSchema?: unknown;
    register: (api: OpenClawPluginApi) => void;
  }): unknown;
}

declare module "openclaw/plugin-sdk/tool-plugin" {
  import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";

  export type ToolFactoryContext = {
    api?: { config?: OpenClawConfig };
    toolContext?: Record<string, unknown>;
  };

  export type ToolDefinitionInput<TParams = Record<string, unknown>> = {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    optional?: boolean;
    execute: (params: TParams, config: Record<string, unknown>, context: ToolExecuteContext) => Promise<unknown>;
    factory?: (ctx: ToolFactoryContext) => AgentToolFromFactory | null;
  };

  export type ToolExecuteContext = {
    signal?: AbortSignal;
    openclawConfig?: OpenClawConfig;
    config?: OpenClawConfig;
  };

  export type AgentToolFromFactory = {
    name: string;
    description: string;
    parameters: unknown;
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      ctx?: ToolExecuteContext,
    ) => Promise<unknown>;
  };

  export function defineToolPlugin(options: {
    id: string;
    name: string;
    description: string;
    configSchema?: unknown;
    tools: (tool: <T extends ToolDefinitionInput>(def: T) => T) => ToolDefinitionInput[];
  }): {
    id: string;
    name: string;
    description: string;
    configSchema: unknown;
    tools: ToolDefinitionInput[];
    register?: (api: import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginApi) => void;
  };
}
