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
  publicClient,
  walletClientFromProvider,
  type MintResult,
} from "./chain";
import {
  ALCHEMY_BASE_SEPOLIA_FAUCET_URL,
  BASE_SEPOLIA_FAUCET_URL,
  SEPOLIA_REGISTRY,
} from "./constants";
import { formatEthTrim, type MintBudget } from "./mint-budget";
import {
  loadOwnedIdentities,
  mergeMintIntoOwned,
  type OwnedOperator,
} from "./owned";
import {
  clearPendingBotKey,
  hasPendingBotKey,
  peekPendingBotKey,
} from "./pending-key";
import { downloadTextFile, shortenAddress } from "./utils";

type Step =
  | "login"
  | "loading"
  | "home"
  | "names"
  | "fund"
  | "minting"
  | "done";

/** names mode: full new name+bot, or bot under an existing operator */
type NamesMode = "new" | "add-bot";

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
  const [namesMode, setNamesMode] = useState<NamesMode>("new");
  const [operatorLabel, setOperatorLabel] = useState("");
  const [botLabel, setBotLabel] = useState("");
  const [operatorAlreadyOurs, setOperatorAlreadyOurs] = useState(false);
  const [owned, setOwned] = useState<OwnedOperator[]>([]);
  const [ownedError, setOwnedError] = useState<string | null>(null);
  const [budget, setBudget] = useState<MintBudget | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mintProgress, setMintProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mint, setMint] = useState<MintResult | null>(null);
  const [keyStillPending, setKeyStillPending] = useState(false);
  const [copied, setCopied] = useState<"snippet" | "address" | null>(null);

  const owner = (wallet?.address ?? null) as Address | null;

  const refreshOwned = useCallback(async (): Promise<OwnedOperator[]> => {
    if (!owner) return [];
    const result = await loadOwnedIdentities(publicClient, owner);
    if (result.status === "error") {
      setOwnedError(
        result.message.includes("timed out")
          ? result.message
          : "Couldn’t load your names from the registry",
      );
    } else {
      setOwnedError(null);
    }
    setOwned(result.operators);
    return result.operators;
  }, [owner]);

  const refreshBudget = useCallback(async () => {
    if (!owner) return;
    setBudgetError(null);
    try {
      const next = await assessJoinBudget(owner, {
        needOperatorFee: !operatorAlreadyOurs,
        needBotFee: true,
      });
      setBudget(next);
    } catch (e) {
      setBudgetError(e instanceof Error ? e.message : String(e));
    }
  }, [owner, operatorAlreadyOurs]);

  // After login: look up owned names before showing pick-a-name.
  // Depend on owner address (string), not step — setStep("loading") used to
  // re-run this effect, cancel the in-flight lookup, and leave the UI stuck.
  useEffect(() => {
    if (!authenticated || !owner) return;

    let cancelled = false;
    setStep("loading");
    setError(null);

    void (async () => {
      const operators = await refreshOwned();
      if (cancelled) return;
      if (operators.length > 0) {
        setStep("home");
      } else {
        setNamesMode("new");
        setOperatorAlreadyOurs(false);
        setStep("names");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, owner, refreshOwned]);

  useEffect(() => {
    if (step === "fund" && owner) {
      void refreshBudget();
      const id = window.setInterval(() => void refreshBudget(), 8000);
      return () => window.clearInterval(id);
    }
  }, [step, owner, refreshBudget]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (hasPendingBotKey()) clearPendingBotKey();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

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
    const chainIdHex = await provider.request({ method: "eth_chainId" });
    const chainId = Number.parseInt(String(chainIdHex), 16);
    if (chainId !== baseSepolia.id) {
      throw new Error(
        "Still not on Base Sepolia — switch network in the wallet UI and try again",
      );
    }
    const client = await walletClientFromProvider(provider, owner);
    return { client, address: owner };
  }

  function startNewName() {
    setError(null);
    setNamesMode("new");
    setOperatorAlreadyOurs(false);
    setOperatorLabel("");
    setBotLabel("");
    setStep("names");
  }

  function startAddComputer(opLabel: string) {
    setError(null);
    setNamesMode("add-bot");
    setOperatorAlreadyOurs(true);
    setOperatorLabel(opLabel);
    setBotLabel("");
    setStep("names");
  }

  async function goHome() {
    setError(null);
    setMint(null);
    setStep("loading");
    const operators = await refreshOwned();
    setStep(operators.length > 0 ? "home" : "names");
    if (operators.length === 0) {
      setNamesMode("new");
      setOperatorAlreadyOurs(false);
    }
  }

  async function onContinueNames() {
    setError(null);
    const op = operatorLabel.trim();
    const bot = botLabel.trim();
    if (namesMode === "add-bot") {
      if (!op || !bot) {
        setError("Pick a computer label");
        return;
      }
    } else if (!op || !bot) {
      setError("Pick both a name and a computer label");
      return;
    }
    setStep("fund");
  }

  async function onMint() {
    setError(null);
    setBusy(true);
    const needOp = !operatorAlreadyOurs;
    setMintProgress(
      needOp
        ? "Approve 1 of 2 — register your name…"
        : "Approve — register this computer…",
    );
    setStep("minting");
    try {
      const { client, address } = await ensureWalletClient();
      const result = await mintOperatorAndBot({
        walletClient: client,
        owner: address,
        operatorLabel,
        botLabel,
        onProgress: (phase) => {
          if (phase === "operator") {
            setMintProgress("Approve 1 of 2 — register your name…");
          } else {
            setMintProgress(
              needOp
                ? "Approve 2 of 2 — register this computer…"
                : "Approve — register this computer…",
            );
          }
        },
      });
      setMint(result);
      if (owner) {
        setOwned((prev) => mergeMintIntoOwned(prev, result, owner));
      }
      const pending = peekPendingBotKey();
      if (pending) {
        downloadTextFile(`${pending.label}.key`, `${pending.key}\n`);
        setKeyStillPending(true);
      }
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
    const pending = peekPendingBotKey();
    if (!pending) return;
    downloadTextFile(`${pending.label}.key`, `${pending.key}\n`);
  }

  function confirmKeySaved() {
    clearPendingBotKey();
    setKeyStillPending(false);
  }

  async function onSignOut() {
    clearPendingBotKey();
    setKeyStillPending(false);
    setMint(null);
    setOwned([]);
    setOwnedError(null);
    setOperatorLabel("");
    setBotLabel("");
    setNamesMode("new");
    setOperatorAlreadyOurs(false);
    setStep("login");
    await logout();
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

  const backFromFund = () => {
    if (owned.length > 0 && namesMode === "add-bot") {
      setStep("home");
    } else if (owned.length > 0 && namesMode === "new") {
      setStep("names");
    } else {
      setStep("names");
    }
  };

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
          <button
            type="button"
            className="btn ghost small"
            onClick={() => void onSignOut()}
          >
            Sign out
          </button>
        </div>
      )}

      {authenticated && !wallet && (
        <p className="join-warn">
          Waiting for your wallet… If this hangs, refresh and try again.
        </p>
      )}

      {authenticated && wallet && step === "loading" && (
        <section className="join-card">
          <h2>Looking up names…</h2>
          <p className="join-muted">
            Checking the Base Sepolia registry for names this address already
            owns. Usually about 10–20 seconds.
          </p>
          {ownedError && (
            <p className="join-warn" role="status">
              {ownedError}
            </p>
          )}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              setNamesMode("new");
              setOperatorAlreadyOurs(false);
              setStep("names");
            }}
          >
            Skip — register a name
          </button>
        </section>
      )}

      {authenticated && wallet && step === "home" && (
        <section className="join-card">
          <p className="join-kicker">On this registry</p>
          <h2>Your names</h2>
          <p>
            This wallet already owns the labels below. Keep each agent{" "}
            <code>.key</code> file private. Mint another computer under a name,
            or claim a new name.
          </p>
          {ownedError && (
            <p className="join-warn" role="status">
              {ownedError}
            </p>
          )}
          <ul className="join-owned">
            {owned.map((op) => (
              <li key={op.id} className="join-owned-op">
                <div className="join-owned-head">
                  <code>{op.label}</code>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => startAddComputer(op.label)}
                  >
                    Register another computer
                  </button>
                </div>
                {op.bots.length === 0 ? (
                  <p className="join-fine">No computers registered yet.</p>
                ) : (
                  <ul className="join-owned-bots">
                    {op.bots.map((b) => (
                      <li key={b.id}>
                        <code>{b.label}</code>
                        <span className="join-muted">
                          {shortenAddress(b.botKey)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <h3>Next steps</h3>
          <ul className="join-next">
            <li>
              Keep each <code>.key</code> file somewhere safe — this page does
              not store it. Lost a key? Mint another computer here (not CLI
              rotate).
            </li>
            <li>
              More computers or names: stay on this page — your login still
              signs.
            </li>
            <li>
              Pair / rotate / transfer need the <strong>owner signer</strong>.
              A read-only CLI profile cannot do those yet. Later: transfer to a
              local <code>op.key</code>.
            </li>
          </ul>

          {owner && owned[0] && (
            <>
              <h3>Attach the CLI (read Facts)</h3>
              <p className="join-fine">
                Owner address: <code className="join-mono">{owner}</code>
              </p>
              <div className="join-actions">
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => void copyText("address", owner)}
                >
                  {copied === "address" ? "Copied" : "Copy owner address"}
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() =>
                    void copyText(
                      "snippet",
                      [
                        `clanker setup --preset sepolia --operator ${owned[0].label} --address ${owner} --skip-key --yes`,
                        "clanker fund",
                        "clanker whoami",
                      ].join("\n"),
                    )
                  }
                >
                  {copied === "snippet" ? "Copied" : "Copy attach commands"}
                </button>
              </div>
              <pre className="join-pre">{`clanker setup --preset sepolia --operator ${owned[0].label} --address ${owner} --skip-key --yes
clanker fund
clanker whoami`}</pre>
              <p className="join-fine">
                That writes a read-only profile (no <code>op.key</code>). Put
                your downloaded <code>.key</code> under{" "}
                <code>~/.openclaw/keys/</code> when you run the agent. Details:{" "}
                <a href="/docs/get-started/">Get started</a>.
              </p>
            </>
          )}

          <div className="join-actions">
            <button
              type="button"
              className="btn primary"
              onClick={startNewName}
            >
              Register another name
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void goHome()}
            >
              Refresh
            </button>
            <a className="btn ghost" href="/docs/operator-owner/">
              Operator owner
            </a>
            <a className="btn ghost" href="/docs/get-started/">
              Get started
            </a>
          </div>
        </section>
      )}

      {authenticated && wallet && step === "names" && (
        <section className="join-card">
          {namesMode === "add-bot" ? (
            <>
              <h2>Register a computer</h2>
              <p>
                Add another agent under <strong>{operatorLabel}</strong>. ASCII
                letters and numbers only (no lookalike Unicode).
              </p>
              {ownedError && owned.length === 0 && (
                <p className="join-warn" role="status">
                  {ownedError}
                </p>
              )}
              <label className="join-label">
                Your name
                <input
                  value={operatorLabel}
                  readOnly
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
            </>
          ) : (
            <>
              <h2>Pick a name</h2>
              <p>
                First-come on this Base Sepolia registry. Use dots, not spaces.
                ASCII letters and numbers only (no lookalike Unicode). The
                computer label is the agent that will run under your name.
              </p>
              {ownedError && (
                <p className="join-warn" role="status">
                  {ownedError}
                </p>
              )}
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
            </>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={() => void onContinueNames()}
          >
            Next — fund
          </button>
          {owned.length > 0 && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setStep("home")}
            >
              Back to your names
            </button>
          )}
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
            {operatorAlreadyOurs ? (
              <>
                You are registering computer <strong>{botLabel}</strong> under{" "}
                <strong>{operatorLabel}</strong> (you already own that name).
                That needs a little Base Sepolia test ETH (computer fee + gas).
              </>
            ) : (
              <>
                You are registering <strong>{operatorLabel}</strong> and{" "}
                <strong>{botLabel}</strong> on the public phone book. That needs
                a little Base Sepolia test ETH (name fee + gas). One faucet drip
                is often not enough — copy the address into CDP →{" "}
                <strong>Faucets</strong>, or try Alchemy.
              </>
            )}
          </p>
          <p className="join-fine">
            Registry contract (check this in the approval UI):{" "}
            <code className="join-mono">{SEPOLIA_REGISTRY}</code>
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
                  Balance:{" "}
                  <strong>{formatEthTrim(budget.balanceWei)} ETH</strong>
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
                {budget.funded && (
                  <li className="join-ok">Funded — ready to register.</li>
                )}
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
            {operatorAlreadyOurs ? (
              <>
                Expect <strong>one</strong> approval for this computer. Confirm
                the registry address above.
              </>
            ) : (
              <>
                Expect <strong>two</strong> approvals: your name, then this
                computer. Confirm the registry address above in each approval.
              </>
            )}
          </p>
          <button
            type="button"
            className="btn ghost small"
            onClick={backFromFund}
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
          {keyStillPending ? (
            <>
              <p>
                The file <code>{mint.botLabel}.key</code> is the key for that
                agent label — separate from your login. Keep it private. Your
                browser should have downloaded it already. Download again only
                works until you confirm below.
              </p>
              <div className="join-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={redownloadKey}
                >
                  Download {mint.botLabel}.key again
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={confirmKeySaved}
                >
                  I saved this key
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                This tab no longer holds the private key. If you still have{" "}
                <code>{mint.botLabel}.key</code>, keep it somewhere safe.
              </p>
              <p className="join-fine">
                Lost the file? Mint another computer label under the same
                operator name on this page — see{" "}
                <a href="/docs/operator-owner/">operator owner</a>.
              </p>
            </>
          )}

          <div className="join-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => void goHome()}
            >
              Your names
            </button>
            <a className="btn ghost" href="/docs/trust-model/">
              Trust model
            </a>
            <a className="btn ghost" href="/docs/operator-owner/">
              Operator owner
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
              <a href="/docs/plugins/">plugins</a>. Pair with{" "}
              <code>clanker pair</code> — not this page.
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

      {error && (
        <p className="join-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
