// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://clanker-chain.com",
  integrations: [
    react(),
    starlight({
      title: "clanker-chain",
      logo: {
        src: "./src/assets/clanker-mark.svg",
        alt: "clanker-chain",
      },
      favicon: "/favicon.svg",
      description:
        "A public on-chain registry for agent names. MQTT and OpenClaw are one working example. Closed beta on Base Sepolia.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/clanker-chain/clanker-chain",
        },
      ],
      sidebar: [
        {
          label: "Philosophy",
          items: [
            { label: "What this is", slug: "docs" },
            { label: "Trust model", slug: "docs/trust-model" },
            { label: "Operator owner", slug: "docs/operator-owner" },
            { label: "Fees", slug: "docs/fees" },
            { label: "Registry lifecycle", slug: "docs/registry-lifecycle" },
          ],
        },
        {
          label: "Use it",
          items: [
            { label: "Prerequisites", slug: "docs/prerequisites" },
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
