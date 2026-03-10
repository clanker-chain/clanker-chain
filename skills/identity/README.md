# Identity skill (OpenClaw)

This folder is an **OpenClaw skill template** for the clanker-chain identity service. Add it to a bot so the agent can register the bot, fetch bot records, and sign coordination messages.

## Adding this skill to your bot

### Option A — Use from the clanker-chain repo (workspace = repo)

1. Use `clanker-chain` (or a copy) as your OpenClaw workspace, or add this skill folder into your workspace:
   - Copy the entire `skills/identity` folder into your workspace’s `skills/` directory, e.g. `~/.openclaw/workspace/skills/identity/`.
2. Install the skill’s dependency (the identity client) from the repo:
   ```bash
   cd /path/to/clanker-chain/skills/identity
   npm install
   ```
   This installs `identity-node-client` from `../../identity-node-client`. Ensure `identity-node-client` is built first:
   ```bash
   cd /path/to/clanker-chain/identity-node-client
   npm install && npm run build
   ```
3. In OpenClaw config, ensure the identity service URL (and optional admin token) are set for the agent, e.g. in `skills.entries.identity.env` or in the environment:
   - `IDENTITY_SERVICE_URL` (e.g. `http://localhost:8080`)
   - `IDENTITY_ADMIN_TOKEN` (if your identity service requires it)

### Option B — Copy skill + client into your workspace

1. Copy both folders into your OpenClaw workspace:
   - `skills/identity` → `~/your-workspace/skills/identity`
   - `identity-node-client` → `~/your-workspace/identity-node-client`
2. In `skills/identity/package.json`, set the dependency to the local client:
   ```json
   "dependencies": {
     "identity-node-client": "file:../../identity-node-client"
   }
   ```
   If you placed the client next to the workspace root, use a path that resolves from `skills/identity` (e.g. `file:../../identity-node-client` when workspace root contains both `skills/` and `identity-node-client/`).
3. Build the client and install the skill:
   ```bash
   cd ~/your-workspace/identity-node-client && npm install && npm run build
   cd ~/your-workspace/skills/identity && npm install
   ```
4. Set `IDENTITY_SERVICE_URL` (and `IDENTITY_ADMIN_TOKEN` if needed) for the agent.

### Option C — Publish the client and depend on it by version

If you publish `identity-node-client` to npm (or a private registry), in `skills/identity/package.json` you can use:

```json
"dependencies": {
  "identity-node-client": "^0.1.0"
}
```

Then anyone can copy only the `skills/identity` folder and run `npm install` inside it.

---

After adding the skill, (re)start the gateway or open a new session so the skill is loaded. The agent can then use `identity_init`, `identity_get_bot`, and `identity_sign` as described in `SKILL.md`.
