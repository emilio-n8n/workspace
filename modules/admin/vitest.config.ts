import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    // La base de test répond parfois lentement : les fixtures des hooks ne
    // doivent pas expirer sur un pic de latence (défaut Vitest : 10 s).
    hookTimeout: 30_000,
  },
});
