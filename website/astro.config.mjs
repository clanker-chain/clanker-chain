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
        "Identity-aware MQTT mesh for OpenClaw bots — closed beta on Base Sepolia.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/pjsandwich/clanker-chain",
        },
      ],
      sidebar: [
        {
          label: "Docs",
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
