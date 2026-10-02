import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const TEST_SERVICE_AUTH_KEYS = JSON.stringify({
  "test-orchestrator": {
    "test-key-1": "worker-test-fixture-secret-32-bytes-minimum",
  },
});
const AUTHORITY_TEST_MIGRATIONS = await readD1Migrations("migrations/authority");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { SERVICE_AUTH_KEYS_JSON: TEST_SERVICE_AUTH_KEYS, AUTHORITY_TEST_MIGRATIONS },
        d1Databases: ["AUTHORITY_DB"],
        queueProducers: ["ORCHESTRATOR_QUEUE"],
        workflows: {
          ORCHESTRATOR_WORKFLOW: {
            name: "8978-ai-orchestrator-dev",
            className: "OrchestratorWorkflow",
          },
        },
      },
    }),
  ],
  test: { include: ["test/worker/**/*.test.js"] },
});
