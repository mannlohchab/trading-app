import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

// Dev: proxy the API (and the market WebSocket) to elysia-backend so the browser stays
// same-origin and the Better Auth session cookie just works. Run `bun run dev` in
// ../../elysia-backend (port 4001), then `bun run dev` here.
// Point at another backend with API_PROXY_TARGET, e.g. the staging server.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const target = (env.API_PROXY_TARGET || "http://127.0.0.1:4001").replace(/\/+$/, "");
  const remote = !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(target);

  const proxy: ProxyOptions = {
    target,
    ws: true,
    // A remote backend only trusts its own origin, so present the request as coming from it.
    // Locally, add http://localhost:5173 to the backend's AUTH_TRUSTED_ORIGINS instead.
    changeOrigin: remote,
    secure: true,
    configure: remote
      ? (p) => {
          const origin = new URL(target).origin;
          p.on("proxyReq", (req) => {
            if (req.getHeader("origin")) req.setHeader("origin", origin);
          });
          p.on("proxyReqWs", (req) => {
            if (req.getHeader("origin")) req.setHeader("origin", origin);
          });
        }
      : undefined,
  };

  return {
    plugins: [tailwindcss(), reactRouter()],
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      proxy: {
        "/api": proxy,
        "/health": { target, changeOrigin: remote },
      },
    },
  };
});
