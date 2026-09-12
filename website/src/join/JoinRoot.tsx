import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";
import { JoinApp } from "./JoinApp";

const appId = import.meta.env.PUBLIC_PRIVY_APP_ID as string | undefined;

export default function JoinRoot() {
  if (!appId) {
    return (
      <div className="join-app">
        <section className="join-card">
          <h2>Join is not configured yet</h2>
          <p>
            This build has no <code>PUBLIC_PRIVY_APP_ID</code>. Use the{" "}
            <a href="/docs/get-started/">CLI get started</a> path, or ask the
            operator to set the Privy app id on the next site deploy.
          </p>
        </section>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        // No "wallet" — embedded EOA via email / Google / passkey only.
        loginMethods: ["email", "google", "passkey"],
        appearance: {
          theme: "dark",
          accentColor: "#c4783a",
          logo: "/brand/clanker-mark-transparent.svg",
        },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
          // Never silent-sign mint — user must confirm in Privy UI.
          showWalletUIs: true,
        },
        // EOA path only — do not default to smart wallets / Base Account.
      }}
    >
      <JoinApp />
    </PrivyProvider>
  );
}
