import { defineConfig } from "vitest/config";

// S1a scaffold only: no UI yet (S3). The test block is read by Vitest.
export default defineConfig({
  test: {
    include: ["engine/tests/**/*.test.ts"],
    environment: "node",
  },
});
