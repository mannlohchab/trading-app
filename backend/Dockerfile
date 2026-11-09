# Production image for the Hono backend.
FROM oven/bun:1.4.2

# bubblewrap sandboxes backtest strategy code; prlimit (util-linux) caps its resources.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap util-linux \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .
ENV PORT=4001
EXPOSE 4001
USER bun

# Apply pending migrations, then start the API.
CMD ["sh", "-c", "bun src/db/migrate.ts && exec bun src/index.ts"]
