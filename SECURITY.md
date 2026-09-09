# Security

## Reporting a vulnerability

Report security issues via **GitHub Security Advisories → Report a vulnerability** on this repository. Do **not** open a public issue for:

- Remote code execution, auth bypass, or key leakage
- Abuse of the experimental shared Sepolia MQTT hub

Include steps to reproduce, affected package versions (CalVer), and impact.

## Experimental shared hub

The Sepolia hostnames in the `sepolia` CLI preset are **invite-only / experimental**. Topic ACLs are not fully hardened. Do not treat them as a production trust boundary. Prefer self-hosting Mosquitto + mqtt-auth for untrusted workloads — see [`SETUP.md`](SETUP.md) and [`mqtt-service/README.md`](mqtt-service/README.md).

## Secrets

Never commit `.env` files, private keys, or npm tokens. Release workflows expect `NPM_TOKEN` as a GitHub Actions secret only.
