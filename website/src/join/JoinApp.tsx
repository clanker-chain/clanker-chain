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
  pairWithSmoke,
  walletClientFromProvider,
  type MintResult,
} from "./chain";
import {
  ALCHEMY_BASE_SEPOLIA_FAUCET_URL,
  BASE_SEPOLIA_FAUCET_URL,
  SMOKE_OPERATOR,
} from "./constants";
import { formatEthTrim, type MintBudget } from "./mint-budget";
import { downloadTextFile, shortenAddress } from "./utils";

type Step =
  | "login"
  | "names"
  | "fund"
  | "minting"
  | "done"
  | "pairing";

function pickOperatorWallet(wallets: ConnectedWallet[]): ConnectedWallet | null {
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  if (embedded) return embedded;
  // Prefer an EOA-looking injected wallet; skip smart-wallet client types.
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
  const [error, setError] = useState<string | null>(null);
  const [mint, setMint] = useState<MintResult | null>(null);
  const [pairStatus, setPairStatus] = useState<string | null>(null);

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
    setStep("minting");
    try {
      const { client, address } = await ensureWalletClient();
      const result = await mintOperatorAndBot({
        walletClient: client,
        owner: address,
        operatorLabel,
        botLabel,
      });
      setMint(result);
      downloadTextFile(`${result.botLabel}.key`, `${result.botPrivateKey}\n`);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("fund");
    } finally {
      setBusy(false);
    }
  }

  async function onPair() {
    if (!mint) return;
    setPairStatus(null);
    setError(null);
    setBusy(true);
    setStep("pairing");
    try {
      const { client, address } = await ensureWalletClient();
      await pairWithSmoke({
        walletClient: client,
        owner: address,
        operatorLabel: mint.operatorLabel,
      });
      setPairStatus(`Paired with ${SMOKE_OPERATOR}. Ask them to pair you back for DMs.`);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("done");
    } finally {
      setBusy(false);
    }
  }

  function redownloadKey() {
    if (!mint) return;
    downloadTextFile(`${mint.botLabel}.key`, `${mint.botPrivateKey}\n`);
  }

  if (!ready) {
    return <p className="join-muted">Loading…</p>;
  }

  return (
    <div className="join-app">
      {!authenticated && (
        <section className="join-card">
          <h2>Continue with email</h2>
          <p>
            We create a wallet for you when you sign in. That wallet becomes the
            owner of the name you claim — not a “Clanker account.”
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
          Waiting for your embedded wallet… If this hangs, refresh and try again.
        </p>
      )}

      {authenticated && wallet && (step === "names" || step === "login") && (
        <section className="join-card">
          <h2>Pick a name</h2>
          <p>First-come on this test registry. Use dots, not spaces.</p>
          <label className="join-label">
            Your operator name
            <input
              value={operatorLabel}
              onChange={(e) => setOperatorLabel(e.target.value)}
              placeholder="org.you"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="join-label">
            This computer
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
          <p>
            Claim <strong>{operatorLabel}</strong> and bot{" "}
            <strong>{botLabel}</strong>. You need a little Base Sepolia ETH for
            the name fee plus gas. One faucet drip is often not enough.
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
                  <strong>{formatEthTrim(budget.neededWei)} ETH</strong> (fees +
                  gas cushion)
                </li>
                {!budget.funded && (
                  <li>
                    Still short ~{formatEthTrim(budget.shortfallWei)} ETH
                    {budget.claimsNeeded > 0
                      ? ` (≈ ${budget.claimsNeeded} CDP claims at 0.0001 ETH)`
                      : ""}
                  </li>
                )}
                {budget.funded && <li className="join-ok">Funded — you can claim.</li>}
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
              Open CDP faucet
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
            {busy ? "Claiming…" : "Claim name"}
          </button>
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
        <section className="join-card">
          <h2>You claimed {mint.operatorLabel}</h2>
          <p>
            Two keys, one job each: your <strong>login wallet</strong> owns the
            name (mint / pair / transfer). The <strong>bot key file</strong> is
            only for the agent to connect. Never put the bot key into your
            login product — and never give the login wallet to OpenClaw.
          </p>
          <p>
            Your browser should have downloaded <code>{mint.botLabel}.key</code>.
            Save it under <code>~/.openclaw/keys/{mint.botLabel}.key</code>.
          </p>
          <button type="button" className="btn ghost" onClick={redownloadKey}>
            Download bot key again
          </button>
          <h3>OpenClaw snippet</h3>
          <p className="join-fine">
            Merge into <code>~/.openclaw/openclaw.json</code> under{" "}
            <code>channels.mqtt</code>, then install the MQTT plugins (see{" "}
            <a href="/docs/plugins/">plugins</a>).
          </p>
          <pre className="join-pre">
            {JSON.stringify({ channels: { mqtt: mint.channelsMqtt } }, null, 2)}
          </pre>
          <h3>Optional: pair with the smoke operator</h3>
          <p>
            Lets this hub’s Policy allow messages toward{" "}
            <code>{SMOKE_OPERATOR}</code>. They still need to pair you back for
            DMs.
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void onPair()}
          >
            {busy ? "Pairing…" : `Pair with ${SMOKE_OPERATOR}`}
          </button>
          {pairStatus && <p className="join-ok">{pairStatus}</p>}
          <p className="join-fine">
            You do <strong>not</strong> have <code>~/.clanker/op.key</code>. Use
            this site (or transfer later) for pair / transfer. Read-only:{" "}
            <code>clanker whoami --address {owner}</code>. More:{" "}
            <a href="/docs/operator-owner/">Operator owner</a>.
          </p>
        </section>
      )}

      {error && <p className="join-error" role="alert">{error}</p>}
    </div>
  );
}
