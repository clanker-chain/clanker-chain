import type { OpenClawCorePluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";

const plugin = {
  id: "identity-client",
  name: "Identity client",
  description: "Identity client and identity skill for clanker-chain bots.",
  configSchema: emptyPluginConfigSchema(),
  register(_api: OpenClawCorePluginApi) {
    // No channels or HTTP routes yet; the primary value is the identity skill
    // shipped via `skills` in openclaw.plugin.json.
  },
};

export default plugin;
