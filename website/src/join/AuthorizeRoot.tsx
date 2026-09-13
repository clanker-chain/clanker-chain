import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";
import { AuthorizeApp } from "./AuthorizeApp";

const appId = import.meta.env.PUBLIC_PRIVY_APP_ID as string | undefined;

export default function AuthorizeRoot() {
  if (!appId) {
    return (
      <div className="join-app">
        <section className="join-card">
          <h2>Authorize is not configured yet</h2>
          <p>
            This build has no <code>PUBLIC_PRIVY_APP_ID</code>. Use a local{" "}
            <code>op.key</code> via <code>clanker setup --generate-key</code>,
            or ask the operator to set the Privy app id on the next site deploy.
          </p>
        </section>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
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
          showWalletUIs: true,
        },
      }}
    >
      <AuthorizeApp />
    </PrivyProvider>
  );
}
