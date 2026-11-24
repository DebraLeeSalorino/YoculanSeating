import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://yoculan:yoculan@localhost:5432/yoculan_test",
      APP_URL: "http://localhost:3000",
      MAIL_TRANSPORT: "memory",
      SQUARE_MODE: "fake",
      SQUARE_WEBHOOK_SIGNATURE_KEY: "test-signature-key",
    },
  },
});
