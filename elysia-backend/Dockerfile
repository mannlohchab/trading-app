# Production image for the Elysia backend.
FROM oven/bun:1.4.2

# bubblewrap sandboxes backtest strategy code; prlimit (util-linux) caps its resources.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap util-linux \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .
ARG BUILD_REVISION=""
ENV BUILD_REVISION=${BUILD_REVISION}
ENV PORT=4001
EXPOSE 4001
USER bun

# API/database readiness; worker namespace isolation must pass before startup.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:' + (process.env.PORT || '4001') + '/health/ready', { signal: AbortSignal.timeout(4000) }); process.exit(response.ok ? 0 : 1);"]

# Prove worker isolation before changing the database or accepting traffic.
CMD ["sh", "-c", "bun src/scripts/verify-backtest-sandbox.ts && bun src/db/migrate.ts && exec bun src/index.ts"]
