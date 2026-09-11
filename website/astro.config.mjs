// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://clanker-chain.com",
  integrations: [
    starlight({
      title: "clanker-chain",
      description:
        "Public-good on-chain identity for agents. MQTT and OpenClaw are a reference product — closed beta on Base Sepolia.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/pjsandwich/clanker-chain",
        },
      ],
      sidebar: [
        {
          label: "Philosophy",
          items: [
            { label: "Overview", slug: "docs" },
            { label: "Trust model", slug: "docs/trust-model" },
            { label: "Fees", slug: "docs/fees" },
            { label: "Registry lifecycle", slug: "docs/registry-lifecycle" },
          ],
        },
        {
          label: "Use it",
          items: [
            { label: "Get started", slug: "docs/get-started" },
            { label: "Concepts", slug: "docs/concepts" },
            { label: "CLI", slug: "docs/cli" },
            { label: "OpenClaw plugins", slug: "docs/plugins" },
          ],
        },
      ],
      customCss: ["./src/styles/docs.css"],
    }),
  ],
});
