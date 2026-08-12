import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const TEST_SERVICE_AUTH_KEYS = JSON.stringify({
  "test-orchestrator": {
    "test-key-1": "worker-test-fixture-secret-32-bytes-minimum",
  },
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { SERVICE_AUTH_KEYS_JSON: TEST_SERVICE_AUTH_KEYS } },
    }),
  ],
  test: { include: ["test/worker/**/*.test.js"] },
});
