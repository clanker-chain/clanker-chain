import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import type { OpenClawConfig, ToolExecuteContext } from "openclaw/plugin-sdk/plugin-entry";
import {
  resolveMqttToolsConfig,
  resolveToolAccountId,
  validateMessageFields,
  validateRecipientBotId,
} from "./mqtt-config.js";
import { sendSignedDm } from "./send-signed-dm.js";

function resolveGatewayConfig(context: ToolExecuteContext): OpenClawConfig {
  return (context.openclawConfig ?? context.config ?? {}) as OpenClawConfig;
}

export default defineToolPlugin({
  id: "mqtt-tools",
  name: "Clanker MQTT Tools",
  description:
    "Agent tools for initiating signed bot-to-bot MQTT messages (companion to @clanker-chain/mqtt-channel-plugin).",
  configSchema: Type.Object({}),
  tools: (tool) => [
    tool({
      name: "mqtt_send",
      label: "MQTT Send",
      description:
        "Send a signed direct message to another bot over MQTT (EIP-712). Requires channels.mqtt and the mqtt channel plugin for inbound/receive. Use canonical bot ids (e.g. openclaw.tooter.prod-1).",
      optional: false,
      parameters: Type.Object({
        to: Type.String({
          description:
            "Recipient canonical bot id (lowercase, dots/hyphens; e.g. openclaw.tooter.prod-1).",
        }),
        text: Type.String({ description: "Message body text." }),
        replyTo: Type.Optional(
          Type.String({ description: "Optional correlation id for threading replies." }),
        ),
      }),
      async execute({ to, text, replyTo }, _config, context) {
        context.signal?.throwIfAborted();

        const recipient = String(to ?? "").trim();
        const body = String(text ?? "").trim();
        const correlation =
          replyTo !== undefined && replyTo !== null ? String(replyTo).trim() : undefined;

        if (!recipient || !body) {
          throw new Error('mqtt_send: "to" and "text" are required.');
        }

        validateRecipientBotId(recipient);
        validateMessageFields(body, correlation);

        const accountId = resolveToolAccountId(context);
        const mqtt = resolveMqttToolsConfig(resolveGatewayConfig(context), accountId);
        return sendSignedDm(
          mqtt,
          {
            to: recipient,
            text: body,
            replyTo: correlation || undefined,
          },
          { signal: context.signal },
        );
      },
    }),
  ],
});
