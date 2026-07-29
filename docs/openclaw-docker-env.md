# OpenClaw Docker: env vars for build and compose (Ubuntu)

Use a **single gitignored env file** on the machine so Docker Compose and Docker build get the values without storing secrets in the repo or exposing them in logs/image history.

## 1. Create an env file on the Ubuntu machine

In the OpenClaw project directory (e.g. `~/services/openclaw`):

```bash
cd ~/services/openclaw
touch .env
chmod 600 .env
```

Edit `.env` and add your values (no quotes unless the value contains spaces):

```bash
# Build: fetch clanker-chain-identity from private GitHub release
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
IDENTITY_ASSET_ID=371654497

# Optional: runtime vars for MQTT / identity (chain-direct)
# CHAIN_RPC_URL=https://sepolia.base.org
# REGISTRY_ADDRESS=0xD650467f9D7A20f37E55ec23Ca1c711598f97958
# MQTT_AUTH_SERVICE_URL=http://mqtt-auth:9090
```

**Important:** Ensure `.env` is in `.gitignore` (e.g. `.env` or `.env.*`) so it is never committed.

## 2. Docker Compose: use the env file

- Compose **automatically** loads `.env` from the project directory when you run `docker compose build` or `docker compose up`. Variables are available for substitution in `docker-compose.yml` as `${VAR}`.
- In `docker-compose.yml`, pass build args from the env file so you don’t hardcode secrets:

```yaml
services:
  openclaw-gateway:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        GITHUB_TOKEN: ${GITHUB_TOKEN}
        IDENTITY_ASSET_ID: ${IDENTITY_ASSET_ID:-371654497}
```

- For **runtime** env vars (MQTT channel / identity client), either:
  - Add `env_file: .env` to the service, or
  - List vars explicitly: `environment: CHAIN_RPC_URL: ${CHAIN_RPC_URL}` / `REGISTRY_ADDRESS: ${REGISTRY_ADDRESS}` so only the names are in the repo and values come from `.env`.
  - Do **not** set `IDENTITY_SERVICE_URL` for CONNECT — that indexer path is deprecated.

Then run:

```bash
docker compose build
docker compose up -d
```

No need to `export` in the shell; Compose reads `.env`.

## 3. Docker build: avoid exposing the token in image history

Build args (e.g. `GITHUB_TOKEN`) can end up in image history and build logs. To avoid that, use **BuildKit secrets** so the token is only mounted during the run and never stored in a layer:

1. In the **Dockerfile**, use a secret instead of an ARG for the token:
   - Replace the `RUN test -n "$GITHUB_TOKEN"` and the `curl` step that uses `$GITHUB_TOKEN` with a `RUN --mount=type=secret,id=GITHUB_TOKEN` that reads from `/run/secrets/GITHUB_TOKEN`.
2. When building, pass the secret from the env file:
   ```bash
   export $(grep -v '^#' .env | xargs)   # load .env into shell
   docker compose build --secret id=GITHUB_TOKEN,env=GITHUB_TOKEN
   ```
   Or use a file: `--secret id=GITHUB_TOKEN,src=.env` (BuildKit will read the file; avoid passing the token on the command line).

If you keep using `--build-arg GITHUB_TOKEN=$GITHUB_TOKEN`, the token can appear in `docker history` and logs; use BuildKit secrets for production.

## 4. Summary

| Goal                         | Approach                                                                 |
|-----------------------------|--------------------------------------------------------------------------|
| Store vars on Ubuntu        | Single `.env` in the OpenClaw project dir; `chmod 600 .env`; keep gitignored |
| Compose sees vars           | Automatic: Compose loads `.env`; use `${VAR}` in docker-compose.yml      |
| Build gets token/asset ID   | `build.args` in compose from `${GITHUB_TOKEN}` / `${IDENTITY_ASSET_ID}` |
| Avoid token in image history| Use BuildKit `--secret` and `RUN --mount=type=secret` in the Dockerfile  |
