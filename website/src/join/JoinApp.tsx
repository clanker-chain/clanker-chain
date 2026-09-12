import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePrivy,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import type { Address, WalletClient } from "viem";
import { baseSepolia } from "viem/chains";
import {
  assessJoinBudget,
  mintOperatorAndBot,
  walletClientFromProvider,
  type MintResult,
} from "./chain";
import {
  ALCHEMY_BASE_SEPOLIA_FAUCET_URL,
  BASE_SEPOLIA_FAUCET_URL,
  SEPOLIA_REGISTRY,
} from "./constants";
import { formatEthTrim, type MintBudget } from "./mint-budget";
import { downloadTextFile, shortenAddress } from "./utils";

type Step = "login" | "names" | "fund" | "minting" | "done";

function pickOperatorWallet(wallets: ConnectedWallet[]): ConnectedWallet | null {
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  if (embedded) return embedded;
  const injected = wallets.find(
    (w) =>
      w.walletClientType !== "privy" &&
      w.connectorType !== "coinbase_wallet" &&
      !String(w.walletClientType).includes("smart"),
  );
  return injected ?? null;
}

export function JoinApp() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const wallet = useMemo(() => pickOperatorWallet(wallets), [wallets]);

  const [step, setStep] = useState<Step>("login");
  const [operatorLabel, setOperatorLabel] = useState("");
  const [botLabel, setBotLabel] = useState("");
  const [budget, setBudget] = useState<MintBudget | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mintProgress, setMintProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mint, setMint] = useState<MintResult | null>(null);
  const [copied, setCopied] = useState<"snippet" | "address" | null>(null);

  const owner = (wallet?.address ?? null) as Address | null;

  const refreshBudget = useCallback(async () => {
    if (!owner) return;
    setBudgetError(null);
    try {
      const next = await assessJoinBudget(owner);
      setBudget(next);
    } catch (e) {
      setBudgetError(e instanceof Error ? e.message : String(e));
    }
  }, [owner]);

  useEffect(() => {
    if (authenticated && wallet && step === "login") {
      setStep("names");
    }
  }, [authenticated, wallet, step]);

  useEffect(() => {
    if (step === "fund" && owner) {
      void refreshBudget();
      const id = window.setInterval(() => void refreshBudget(), 8000);
      return () => window.clearInterval(id);
    }
  }, [step, owner, refreshBudget]);

  async function ensureWalletClient(): Promise<{
    client: WalletClient;
    address: Address;
  }> {
    if (!wallet || !owner) {
      throw new Error("No wallet yet — continue with email first");
    }
    if (wallet.chainId !== `eip155:${baseSepolia.id}`) {
      await wallet.switchChain(baseSepolia.id);
    }
    const provider = await wallet.getEthereumProvider();
    const client = await walletClientFromProvider(provider, owner);
    return { client, address: owner };
  }

  async function onContinueNames() {
    setError(null);
    const op = operatorLabel.trim();
    const bot = botLabel.trim();
    if (!op || !bot) {
      setError("Pick both a name and a computer label");
      return;
    }
    setStep("fund");
  }

  async function onMint() {
    setError(null);
    setBusy(true);
    setMintProgress("Approve 1 of 2 — register your name…");
    setStep("minting");
    try {
      const { client, address } = await ensureWalletClient();
      const result = await mintOperatorAndBot({
        walletClient: client,
        owner: address,
        operatorLabel,
        botLabel,
        onProgress: (phase) => {
          setMintProgress(
            phase === "operator"
              ? "Approve 1 of 2 — register your name…"
              : "Approve 2 of 2 — register this computer…",
          );
        },
      });
      setMint(result);
      downloadTextFile(`${result.botLabel}.key`, `${result.botPrivateKey}\n`);
      setMintProgress(null);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMintProgress(null);
      setStep("fund");
    } finally {
      setBusy(false);
    }
  }

  function redownloadKey() {
    if (!mint) return;
    downloadTextFile(`${mint.botLabel}.key`, `${mint.botPrivateKey}\n`);
  }

  async function copyText(kind: "snippet" | "address", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not copy — select the text manually");
    }
  }

  if (!ready) {
    return <p className="join-muted">Loading…</p>;
  }

  const snippet = mint
    ? JSON.stringify({ channels: { mqtt: mint.channelsMqtt } }, null, 2)
    : "";

  return (
    <div className="join-app">
      {!authenticated && (
        <section className="join-card">
          <h2>Continue with email</h2>
          <p>
            Sign in to create a wallet that will own the name you claim. That is
            not a “Clanker account” — only an address on the public registry.
          </p>
          <button type="button" className="btn primary" onClick={() => login()}>
            Continue
          </button>
          <p className="join-fine">
            Prefer the terminal?{" "}
            <a href="/docs/get-started/">CLI get started</a>
          </p>
        </section>
      )}

      {authenticated && (
        <div className="join-status">
          <span>
            Signed in
            {user?.email?.address ? ` as ${user.email.address}` : ""}
            {owner ? ` · ${shortenAddress(owner)}` : ""}
          </span>
          <button type="button" className="btn ghost small" onClick={() => logout()}>
            Sign out
          </button>
        </div>
      )}

      {authenticated && !wallet && (
        <p className="join-warn">
          Waiting for your wallet… If this hangs, refresh and try again.
        </p>
      )}

      {authenticated && wallet && (step === "names" || step === "login") && (
        <section className="join-card">
          <h2>Pick a name</h2>
          <p>
            First-come on this Base Sepolia registry. Use dots, not spaces.
            The computer label is the agent that will run under your name.
          </p>
          <label className="join-label">
            Your name
            <input
              value={operatorLabel}
              onChange={(e) => setOperatorLabel(e.target.value)}
              placeholder="org.you"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="join-label">
            This computer / agent
            <input
              value={botLabel}
              onChange={(e) => setBotLabel(e.target.value)}
              placeholder="you.laptop"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="button" className="btn primary" onClick={() => void onContinueNames()}>
            Next — fund
          </button>
        </section>
      )}

      {authenticated && wallet && (step === "fund" || step === "minting") && (
        <section className="join-card">
          <h2>Fund this address</h2>
          <p className="join-mono">{owner}</p>
          <div className="join-actions">
            <button
              type="button"
              className="btn ghost small"
              onClick={() => owner && void copyText("address", owner)}
            >
              {copied === "address" ? "Copied" : "Copy address"}
            </button>
          </div>
          <p>
            You are registering <strong>{operatorLabel}</strong> and{" "}
            <strong>{botLabel}</strong> on the public phone book. That needs a
            little Base Sepolia test ETH (name fee + gas). One faucet drip is
            often not enough — copy the address into CDP →{" "}
            <strong>Faucets</strong>, or try Alchemy.
          </p>
          {budgetError && <p className="join-error">{budgetError}</p>}
          {budget && (
            <div className="join-budget">
              <div className="join-bar-track" aria-hidden="true">
                <div
                  className="join-bar-fill"
                  style={{
                    width: `${Math.min(
                      100,
                      budget.neededWei === 0n
                        ? 100
                        : Number((budget.balanceWei * 100n) / budget.neededWei),
                    )}%`,
                  }}
                />
              </div>
              <ul>
                <li>
                  Balance: <strong>{formatEthTrim(budget.balanceWei)} ETH</strong>
                </li>
                <li>
                  Need about:{" "}
                  <strong>{formatEthTrim(budget.neededWei)} ETH</strong>
                </li>
                {!budget.funded && (
                  <li>
                    Still short ~{formatEthTrim(budget.shortfallWei)} ETH
                    {budget.claimsNeeded > 0
                      ? ` (≈ ${budget.claimsNeeded} CDP claims at 0.0001 ETH)`
                      : ""}
                  </li>
                )}
                {budget.funded && <li className="join-ok">Funded — ready to register.</li>}
              </ul>
            </div>
          )}
          <div className="join-actions">
            <a
              className="btn ghost"
              href={BASE_SEPOLIA_FAUCET_URL}
              target="_blank"
              rel="noreferrer"
            >
              Open CDP portal
            </a>
            <a
              className="btn ghost"
              href={ALCHEMY_BASE_SEPOLIA_FAUCET_URL}
              target="_blank"
              rel="noreferrer"
            >
              Alchemy faucet
            </a>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void refreshBudget()}
            >
              Refresh balance
            </button>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={!budget?.funded || busy}
            onClick={() => void onMint()}
          >
            {busy ? "Registering…" : "Register on the registry"}
          </button>
          {mintProgress && <p className="join-muted">{mintProgress}</p>}
          <p className="join-fine">
            Expect <strong>two</strong> approvals: your name, then this
            computer. After “All done” on the first, approve the second.
          </p>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setStep("names")}
            disabled={busy}
          >
            Back
          </button>
        </section>
      )}

      {step === "done" && mint && (
        <section className="join-card join-done">
          <p className="join-kicker">On the registry</p>
          <h2>{mint.operatorLabel}</h2>
          <p>
            Your name is recorded on the public Base Sepolia registry. Anyone
            can look it up. Your login wallet (
            <code>{shortenAddress(owner ?? "")}</code>) owns it — mint,
            transfer, and revoke happen from that address.
          </p>
          <ul className="join-facts">
            <li>
              <span>Name</span>
              <code>{mint.operatorLabel}</code>
            </li>
            <li>
              <span>Computer / agent</span>
              <code>{mint.botLabel}</code>
            </li>
            <li>
              <span>Owner</span>
              <code>{owner}</code>
            </li>
            <li>
              <span>Registry</span>
              <code>{SEPOLIA_REGISTRY}</code>
            </li>
          </ul>

          <h3>Save your agent key</h3>
          <p>
            The file <code>{mint.botLabel}.key</code> is the key for that agent
            label — separate from your login. Keep it private. Your browser
            should have downloaded it already.
          </p>
          <button type="button" className="btn primary" onClick={redownloadKey}>
            Download {mint.botLabel}.key again
          </button>

          <h3>What this is (and is not)</h3>
          <p>
            You joined the <strong>registry</strong> — a phone book of names and
            keys. That does not add you to a chat network or friend list. Other
            products decide who they listen to.
          </p>
          <div className="join-actions">
            <a className="btn ghost" href="/docs/trust-model/">
              Trust model
            </a>
            <a className="btn ghost" href="/docs/operator-owner/">
              Operator owner
            </a>
            <a className="btn ghost" href="/docs/">
              Docs
            </a>
          </div>

          <details className="join-details">
            <summary>Later: experimental chat mesh (optional)</summary>
            <p>
              A separate product in this repo uses MQTT + OpenClaw so agents can
              message with these names. It is invite-only and not required to
              hold a registry name.
            </p>
            <p>
              If you already run OpenClaw, save the key under{" "}
              <code>~/.openclaw/keys/{mint.botLabel}.key</code>, then follow{" "}
              <a href="/docs/get-started/">Get started</a> (mesh door) and{" "}
              <a href="/docs/plugins/">plugins</a>.
            </p>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => void copyText("snippet", snippet)}
            >
              {copied === "snippet" ? "Copied" : "Copy OpenClaw snippet"}
            </button>
            <pre className="join-pre">{snippet}</pre>
          </details>
        </section>
      )}

      {error && <p className="join-error" role="alert">{error}</p>}
    </div>
  );
}
