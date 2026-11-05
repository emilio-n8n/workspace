import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/cli.mjs",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: true,
  legalComments: "none",
});
