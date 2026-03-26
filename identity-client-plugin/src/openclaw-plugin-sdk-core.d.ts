declare module "openclaw/plugin-sdk/core" {
  // This package is built and typechecked outside an OpenClaw checkout.
  // At runtime, OpenClaw provides the real module.
  //
  // We only need minimal declarations for CI/local TypeScript compilation
  // so bundling can succeed even when `openclaw` isn't installed here.
  export type OpenClawCorePluginApi = unknown;

  export function emptyPluginConfigSchema(): {
    type: "object";
    additionalProperties: false;
    properties: {};
  };
}

