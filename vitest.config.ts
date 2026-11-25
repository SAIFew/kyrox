import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "packages/**/test/**/*.test.ts",
      "services/**/test/**/*.test.ts",
      "apps/web/test/**/*.test.ts",
    ],
    passWithNoTests: false,
  },
});
