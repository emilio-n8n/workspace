import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { loadDotEnv } from "@workspace/config";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
  plugins: [
    repoEnv(),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      devOptions: { enabled: false },
      manifest: {
        name: "Workspace — Accueil",
        short_name: "Accueil",
        description: "Suite bureautique libre et auto-hébergeable",
        display: "standalone",
        start_url: "/",
        scope: "/",
        // #1a2f2b approxime le token --rail (oklch(0.21 0.02 160)).
        theme_color: "#1a2f2b",
        background_color: "#f7f4ee",
        icons: [
          { src: "/pwa/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/pwa/maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/",
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});

export default config;
