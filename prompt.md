# Investigative / cleanup report — OpenClaw context usage

You are on bot host: tooter-bot
Broker stack (not on this host unless noted): 127.0.0.1 — Anvil, identity :8080, mqtt-auth :9090, MQTT :1883.
We are NOT using Docker. Gateway runs natively (likely systemctl --user openclaw-gateway.service).

## Mission

Produce an investigative report on why sessions show **100% context used**, then perform safe cleanup and recommend durable fixes. Do not change unrelated production config without stating what you changed.

---

## Phase 1 — Inventory (read-only)

### 1.1 Host & gateway

- hostname, LAN IP, OS
- `systemctl --user status openclaw-gateway.service` (active? recent restarts?)
- OpenClaw version if available: `openclaw --version` or gateway logs
- Config path: `~/.openclaw/openclaw.json` — note `channels.mqtt`, `agents.defaults`, `plugins.entries` (do NOT paste secrets or private keys)

### 1.2 Identity / MQTT (sanity only)

- Key file: `ls -la ~/.openclaw/keys/<BOT_ID>.key` — size and prefix only (`wc -c`, `head -c 2`; must be 67 bytes, `0x`)
- Reachability:
  - `curl -fsS http://127.0.0.1:8080/health`
  - `curl -fsS http://127.0.0.1:8080/v1/bots/<BOT_ID>` (status + secp256k1 public_key only)
  - `curl -fsS http://127.0.0.1:9090/health`
- MQTT channel: last 40 lines of gateway journal mentioning mqtt / identity / compaction (no private keys)

### 1.3 Session store (gateway host = this machine)

- `openclaw status` (if CLI available)
- `openclaw sessions` or `openclaw sessions --json` — list session keys, ages, token fields if shown
- Session dir (typical): `~/.openclaw/agents/*/sessions/` — count `.jsonl` transcripts, largest files (`du -sh` top 5)
- `openclaw sessions cleanup --dry-run` — report what would be pruned (do not `--enforce` unless instructed)

### 1.4 Context breakdown (in the busiest chat session)

In the session that shows 100% context (or the main operator DM session), run and capture full output:

- `/status`
- `/context list`
- `/context detail` (if available)

Summarize top contributors:
- System prompt size
- Injected workspace files (which are TRUNCATED / largest)
- Skills count
- Largest tool schemas
- Session tokens / context window / compaction count

Optional: `/context map` if supported — note whether it rendered.

### 1.5 Workspace bloat

In the agent workspace (from status or config):

- Sizes of: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `memory/`
- Any huge logs, dumps, or artifacts the agent wrote into the workspace

---

## Phase 2 — Safe cleanup (execute, document each step)

Do these in order; stop and report if a step fails.

### 2.1 Session relief (user-visible chat)

For the session at 100% context:

1. Run `/status` — record % and `Compactions: N`
2. Run `/compact Focus on: active task, MQTT/identity config, open decisions. Omit old tool logs and repeated curl/journalctl output.`
3. Run `/status` again — record new %
4. If still ~100% OR compaction errors OR `Compactions: 0` with overflow errors in logs → run `/new`, then send ONE short recap message to the user listing only what must be remembered for the current task

Do NOT run `/new` on every session — only stuck or clearly broken ones.

### 2.2 Gateway / disk hygiene (non-destructive first)

- `openclaw sessions cleanup --dry-run` — include output in report
- If dry-run shows large reclaimable junk AND operator has not forbidden it: `openclaw sessions cleanup --enforce` — report bytes/sessions removed

### 2.3 Log noise discipline (ongoing)

Add a note in the report: agent should avoid pasting full `journalctl`, full `curl` bodies, or multi-KB tool output into chat; summarize instead.

---

## Phase 3 — Recommendations (analysis only unless asked to apply)

Based on Phase 1–2, recommend specific `openclaw.json` changes (show a minimal JSON snippet, not the whole file):

| Symptom | Likely fix |
|--------|------------|
| Tool-heavy runs, Anthropic or API | `agents.defaults.contextPruning: { mode: "cache-ttl", ttl: "5m" }` |
| Hits 100% before auto-compact | `agents.defaults.compaction.reserveTokensFloor` tuned to model (e.g. 45000 on ~200k window) |
| Long tool loops (MQTT/debug) | `agents.defaults.compaction.midTurnPrecheck.enabled: true` |
| Huge TOOLS.md / bootstrap | Lower `bootstrapMaxChars` / `bootstrapTotalMaxChars`; trim workspace files |
| Many idle old sessions | periodic `openclaw sessions cleanup --enforce` |
| Stuck session | `/new` per task; don't reuse one endless setup thread |

Also note:
- Model id in use and its context window (from /status)
- Whether compaction count is increasing after `/compact`
- Whether 100% is UI stale vs real (compare /status before and after compact)

Only APPLY config edits if the user message explicitly says to; otherwise recommendations only.

---

## Phase 4 — Deliverable format

Reply with this structure:

## Executive summary
(2–4 sentences: root cause hypothesis, what you cleaned, current context %)

## Host
- hostname, IP, gateway status

## Context investigation
- /status before → after compact
- Top 5 context contributors from /context list|detail
- Model + context window + compaction count
- Largest session transcripts (paths + sizes)

## MQTT / identity (this bot)
- Key format OK? (yes/no, size only)
- Broker health OK? (yes/no)
- MQTT channel connected? (yes/no + log excerpt)

## Cleanup actions taken
- bullet list: /compact, /new, sessions cleanup, etc.

## Recommended config / workspace changes
- minimal JSON snippets + file trims

## Risks / follow-ups
- anything needing operator (broker host, key copy, package version, OpenClaw upgrade)

## Do NOT
- Print private keys or full openclaw.json secrets
- Re-mint on-chain identities
- Uninstall mqtt@2026.5.23 without explicit instruction
- Force sessions cleanup --enforce on production without dry-run summary in the report