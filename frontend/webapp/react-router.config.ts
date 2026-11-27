import type { Config } from "@react-router/dev/config";

export default {
  // Trading terminal uses browser-only APIs (canvas chart); SPA mode avoids SSR issues.
  ssr: false,
} satisfies Config;
