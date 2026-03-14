FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY src ./src
EXPOSE 9090
ENV MQTT_AUTH_PORT=9090
CMD ["bun", "run", "src/server.ts"]
