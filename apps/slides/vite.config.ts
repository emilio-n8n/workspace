import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { loadDotEnv } from "@workspace/config";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

/**
 * Rend le `.env` du monorepo disponible côté serveur (SSR, server functions).
 * Les variables déjà présentes dans l'environnement ne sont jamais écrasées.
 */
function repoEnv(): Plugin {
  return {
    name: "workspace-repo-env",
    config() {
      loadDotEnv(new URL("../..", import.meta.url).pathname);
      return null;
    },
  };
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [repoEnv(), devtools(), tailwindcss(), tanstackStart(), nitro(), viteReact()],
});

export default config;
