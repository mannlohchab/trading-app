# Static SPA build served by nginx, which also reverse-proxies /api (including the market
# WebSocket) and /health to elysia-backend, so the browser stays same-origin.
#
#   docker build -t zrs-webapp .
#   docker run -p 8080:80 -e BACKEND_URL=http://backend:4001 zrs-webapp
#
# The public origin of this site must be in the backend's AUTH_TRUSTED_ORIGINS.

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# The build runs on Node: React Router's SPA prerender fails under Bun's runtime.
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node node_modules/@react-router/dev/bin.cjs build

FROM nginx:1.29-alpine
# Upstream for /api and /health, e.g. http://backend:4001 or https://api.example.com.
ENV BACKEND_URL=http://backend:4001
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/build/client /usr/share/nginx/html
EXPOSE 80
