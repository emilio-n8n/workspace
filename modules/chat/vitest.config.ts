import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    // Tous les fichiers partagent la MÊME base de test : les exécuter en
    // parallèle rendrait fragiles les assertions globales (par exemple « aucune
    // pièce jointe orpheline ») et les suppressions en cascade. Un fichier à la
    // fois, dans l'ordre.
    fileParallelism: false,
  },
});
