import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useMemo, useState } from "react";

const PRIVY_APP_ID = import.meta.env.PUBLIC_PRIVY_APP_ID as string | undefined;

type Status = "idle" | "working" | "approved" | "denied" | "error";

/**
 * Device-authorization approval page for `clanker login`.
 * Privy dashboard Verification URI must point here (e.g. https://clanker-chain.com/authorize).
 */
export function AuthorizeApp() {
  const { ready, authenticated, login, logout, getAccessToken, user } =
    usePrivy();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const userCode = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("user_code") ?? "";
  }, []);

  const submit = useCallback(
    async (action: "approve" | "deny") => {
      if (!PRIVY_APP_ID) return;
      if (!userCode) {
        setError("No code found. Open the link printed by clanker login.");
        setStatus("error");
        return;
      }
      if (!authenticated) {
        await login();
        return;
      }
      setStatus("working");
      setError(null);
      try {
        const userAccessToken = await getAccessToken();
        if (!userAccessToken) {
          throw new Error("Could not get login token — try Continue again.");
        }
        const res = await fetch(
          "https://auth.privy.io/api/oauth/v2/device_verify",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "privy-app-id": PRIVY_APP_ID,
              Authorization: `Bearer ${userAccessToken}`,
            },
            body: JSON.stringify({ user_code: userCode, action }),
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `device_verify failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
          );
        }
        setStatus(action === "approve" ? "approved" : "denied");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [authenticated, getAccessToken, login, userCode],
  );

  if (!ready) {
    return (
      <section className="join-card">
        <h2>Loading…</h2>
        <p>Checking login.</p>
      </section>
    );
  }

  if (!userCode) {
    return (
      <section className="join-card">
        <h2>No authorization code</h2>
        <p>
          Open the link from <code>clanker login</code> (it includes{" "}
          <code>user_code</code>). Or run that command again.
        </p>
        <p className="join-fine">
          This page only approves a terminal that asked to use your operator
          wallet. It does not mint names.
        </p>
      </section>
    );
  }

  if (status === "approved") {
    return (
      <section className="join-card">
        <h2>Approved</h2>
        <p>
          Return to the terminal — <code>clanker login</code> should finish on
          its own. You can close this tab.
        </p>
      </section>
    );
  }

  if (status === "denied") {
    return (
      <section className="join-card">
        <h2>Denied</h2>
        <p>
          The CLI will not get access. If that was a mistake, run{" "}
          <code>clanker login</code> again.
        </p>
      </section>
    );
  }

  return (
    <section className="join-card">
      <h2>Authorize CLI access</h2>
      <p>
        A machine running <code>clanker login</code> wants to use{" "}
        <strong>your operator wallet</strong> (mint, pair, rotate, transfer).
        Approve only if you just started that command.
      </p>
      <p className="join-mono">
        Code: <strong>{userCode}</strong>
      </p>
      {authenticated ? (
        <p className="join-fine">
          Signed in
          {user?.email?.address ? ` as ${user.email.address}` : ""}. The CLI
          never receives your operator private key — only short-lived signing
          tokens.
        </p>
      ) : (
        <p className="join-fine">
          Sign in with the same email / Google / passkey you use on{" "}
          <a href="/join">/join</a>.
        </p>
      )}
      {error && <p className="join-error">{error}</p>}
      <div className="join-actions">
        {!authenticated ? (
          <button type="button" className="btn primary" onClick={() => login()}>
            Continue
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={status === "working"}
              onClick={() => void submit("approve")}
            >
              {status === "working" ? "Working…" : "Approve"}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={status === "working"}
              onClick={() => void submit("deny")}
            >
              Deny
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void logout()}
            >
              Log out
            </button>
          </>
        )}
      </div>
    </section>
  );
}
