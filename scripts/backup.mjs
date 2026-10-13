#!/usr/bin/env node
/**
 * Sauvegarde de l'instance : base PostgreSQL (pg_dump format custom) +
 * répertoire de stockage (si driver local), avec rétention.
 *
 * Usage :
 *   pnpm backup                    # sauvegarde immédiate
 *   BACKUP_DIR=/mnt/backups pnpm backup
 *   BACKUP_RETENTION_DAYS=30 pnpm backup
 *
 * À planifier (cron / systemd timer) — exemple :
 *   0 3 * * *  cd /srv/workspace && /usr/bin/env pnpm backup >> /var/log/workspace-backup.log 2>&1
 *
 * La restauration est documentée dans docs/deployment/self-hosting.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getServerEnv, loadDotEnv } from "../packages/config/src/index.ts";

loadDotEnv();
const env = getServerEnv();

const backupDir = resolve(process.env.BACKUP_DIR ?? "./backups");
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? "14");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

if (!Number.isFinite(retentionDays) || retentionDays < 1) {
  console.error("BACKUP_RETENTION_DAYS invalide (≥ 1 attendu).");
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

const results = [];
try {
  // 1) Base de données — format custom (restauration sélective possible).
  const dbFile = join(backupDir, `db-${stamp}.dump`);
  execFileSync("pg_dump", [env.DATABASE_URL, "-Fc", "-f", dbFile], { stdio: "inherit" });
  results.push(["base de données", dbFile, statSync(dbFile).size]);

  // 2) Stockage local (binaires) — ignoré si driver S3.
  const storageDir = process.env.STORAGE_DIR;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "local" && storageDir && existsSync(storageDir)) {
    const storageFile = join(backupDir, `storage-${stamp}.tar.gz`);
    execFileSync("tar", ["-czf", storageFile, "-C", storageDir, "."], { stdio: "inherit" });
    results.push(["stockage", storageFile, statSync(storageFile).size]);
  } else if (driver === "s3") {
    console.log(
      "Stockage S3 : la sauvegarde des binaires relève du fournisseur (versioning du bucket).",
    );
  } else {
    console.log("Stockage local introuvable : sauvegarde des binaires ignorée.");
  }

  // 3) Rétention : purge des fichiers de sauvegarde trop anciens.
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let pruned = 0;
  for (const name of readdirSync(backupDir)) {
    if (!/^(db|storage)-.*\.(dump|tar\.gz)$/.test(name)) continue;
    const path = join(backupDir, name);
    if (statSync(path).mtimeMs < cutoff) {
      rmSync(path);
      pruned += 1;
    }
  }

  const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  console.log("\nSauvegarde terminée :");
  for (const [label, file, size] of results) {
    console.log(`  ${label.padEnd(16)} ${file}  (${mb(size)})`);
  }
  console.log(
    `  rétention        ${retentionDays} jour(s) — ${pruned} ancien(s) fichier(s) purgé(s)`,
  );
} catch (error) {
  console.error("Sauvegarde échouée :", error instanceof Error ? error.message : error);
  process.exit(1);
}
