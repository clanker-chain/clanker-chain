# Build from repo root:
#   docker build -f hub/mqtt-auth-service/Dockerfile .
FROM oven/bun:1

# Mirror monorepo layout so package.json `file:../../packages/identity-node-client` resolves.
WORKDIR /packages/identity-node-client
COPY packages/identity-node-client/package.json packages/identity-node-client/package-lock.json* packages/identity-node-client/tsconfig*.json ./
COPY packages/identity-node-client/src ./src
RUN bun install && bunx tsc -p tsconfig.build.json

WORKDIR /hub/mqtt-auth-service
COPY hub/mqtt-auth-service/package.json hub/mqtt-auth-service/bun.lock ./
RUN bun install
COPY hub/mqtt-auth-service/src ./src
EXPOSE 9090
ENV MQTT_AUTH_PORT=9090
CMD ["bun", "run", "src/server.ts"]
