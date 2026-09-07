# Build from repo root:
#   docker build -f mqtt-auth-service/Dockerfile .
FROM oven/bun:1

# Sibling of /app so package.json `file:../identity-node-client` resolves correctly.
WORKDIR /identity-node-client
COPY identity-node-client/package.json identity-node-client/package-lock.json* identity-node-client/tsconfig*.json ./
COPY identity-node-client/src ./src
RUN bun install && bunx tsc -p tsconfig.build.json

WORKDIR /app
COPY mqtt-auth-service/package.json mqtt-auth-service/bun.lock ./
RUN bun install
COPY mqtt-auth-service/src ./src
EXPOSE 9090
ENV MQTT_AUTH_PORT=9090
CMD ["bun", "run", "src/server.ts"]
