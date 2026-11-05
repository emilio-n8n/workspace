import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { SyncApi, SyncApiError } from "./api.ts";
import {
  defaultConfigPath,
  loadConfig,
  loadState,
  normalizeConfig,
  normalizeRemotePath,
  resolveToken,
  saveConfig,
} from "./config.ts";
import { formatResult, syncAll } from "./engine.ts";
import type { SyncConfig, SyncMode } from "./types.ts";

const VERSION = "0.1.0";

const HELP = `Workspace Sync — synchronisation locale du Drive Workspace.

Usage :
  workspace-sync init [options]     crée la configuration
  workspace-sync run [options]      lance une passe ou le daemon
  workspace-sync status             affiche l'état local
  workspace-sync help               affiche cette aide

Options d'initialisation :
  --url <url>            URL du Drive (ex. https://drive.exemple.org)
  --token <wsk_…>        jeton d'API (sinon WORKSPACE_SYNC_TOKEN)
  --local <chemin>       dossier local à synchroniser
  --remote <chemin>      dossier distant (défaut : /)
  --mode <mode>          two-way | upload | download (défaut : two-way)
  --device <nom>         nom de l'appareil (défaut : nom de la machine)
  --interval <secondes>  intervalle du daemon (défaut : 30)
  --ignore <motif>       motif à ignorer (répétable)
  --mirror-deletes       propager aussi les suppressions en mode one-way
  --config <chemin>      configuration personnalisée
  --force                remplace une configuration existante

Options d'exécution :
  --once                 une seule passe puis sortie
  --verbose              détaille chaque action
  --config <chemin>      configuration personnalisée

Exemples :
  workspace-sync init --url https://drive.exemple.org --token wsk_… \\
    --local ~/Workspace --mode two-way
  workspace-sync run --once --verbose
  WORKSPACE_SYNC_TOKEN=wsk_… workspace-sync run
`;

type ParsedArgs = ReturnType<typeof parseArgs>;

function parseCliArgs(args: string[]): ParsedArgs {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: {
      config: { type: "string" },
      url: { type: "string" },
      token: { type: "string" },
      local: { type: "string" },
      remote: { type: "string" },
      mode: { type: "string" },
      device: { type: "string" },
      interval: { type: "string" },
      ignore: { type: "string", multiple: true },
      "mirror-deletes": { type: "boolean" },
      force: { type: "boolean" },
      once: { type: "boolean" },
      verbose: { type: "boolean" },
      help: { type: "boolean" },
      version: { type: "boolean" },
    },
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return [value];
  return [];
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function parseMode(value: string): SyncMode {
  if (value === "two-way" || value === "upload" || value === "download") return value;
  throw new Error(`Mode inconnu : ${value}. Valeurs : two-way, upload, download.`);
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function init(parsed: ParsedArgs): Promise<void> {
  const values = parsed.values;
  const configPath = resolve(stringValue(values.config) ?? defaultConfigPath());

  if (existsSync(configPath) && !booleanValue(values.force)) {
    throw new Error(
      `La configuration existe déjà : ${configPath}. Utilisez --force pour la remplacer.`,
    );
  }

  const serverUrl = stringValue(values.url);
  const local = stringValue(values.local);
  if (!serverUrl) throw new Error("--url est requis (URL du Drive).");
  if (!local) throw new Error("--local est requis (dossier local à synchroniser).");

  const tokenFlag = stringValue(values.token);
  const token = tokenFlag ?? process.env.WORKSPACE_SYNC_TOKEN?.trim();
  if (!token) {
    throw new Error("Jeton requis : --token ou WORKSPACE_SYNC_TOKEN.");
  }

  const mode = parseMode(stringValue(values.mode) ?? "two-way");
  const intervalSeconds = Number(stringValue(values.interval) ?? "30");
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 86_400) {
    throw new Error("--interval doit être un entier entre 5 et 86400 secondes.");
  }

  const config = normalizeConfig(
    {
      serverUrl,
      token: tokenFlag,
      deviceName: stringValue(values.device) ?? hostname(),
      intervalSeconds,
      folders: [
        {
          localPath: expandHome(local),
          remotePath: normalizeRemotePath(stringValue(values.remote) ?? "/"),
          mode,
          ignore: stringArray(values.ignore),
          mirrorDeletes: booleanValue(values["mirror-deletes"]),
        },
      ],
    },
    process.cwd(),
  );

  const folder = config.folders[0];
  if (!folder) throw new Error("Aucun dossier configuré.");
  await mkdir(folder.localPath, { recursive: true });

  // Vérifie le jeton et les scopes avant d'écrire la configuration.
  const api = new SyncApi(config.serverUrl, token);
  const identity = await api.me();
  if (!identity.scopes.includes("drive:read")) {
    throw new Error("Le jeton n'a pas le scope drive:read.");
  }
  if (mode !== "download" && !identity.scopes.includes("drive:write")) {
    throw new Error(`Le mode ${mode} exige le scope drive:write.`);
  }

  saveConfig(config, configPath);

  console.log(`Configuration écrite : ${configPath}`);
  console.log(`Appareil : ${config.deviceName}`);
  console.log(`Dossier : ${folder.localPath} → ${folder.remotePath} (${folder.mode})`);
  console.log(`Jeton : ${identity.userId} · ${identity.organizationId}`);
  if (!tokenFlag) {
    console.log("Le jeton vient de WORKSPACE_SYNC_TOKEN : il n'est pas stocké dans le fichier.");
  }
  console.log("Prochaine étape : workspace-sync run --once --verbose");
}

async function run(parsed: ParsedArgs): Promise<void> {
  const values = parsed.values;
  const configPath = resolve(stringValue(values.config) ?? defaultConfigPath());
  const config = loadConfig(configPath);
  const once = booleanValue(values.once);
  const verbose = booleanValue(values.verbose);

  // Vérifie le jeton une fois avant la boucle (message clair en cas de révocation).
  const api = new SyncApi(config.serverUrl, resolveToken(config));
  const identity = await api.me();
  if (!identity.scopes.includes("drive:read")) {
    throw new Error("Le jeton n'a pas le scope drive:read.");
  }
  if (
    config.folders.some((folder) => folder.mode !== "download") &&
    !identity.scopes.includes("drive:write")
  ) {
    throw new Error("Un dossier en mode upload/two-way exige le scope drive:write.");
  }

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  do {
    const startedAt = Date.now();
    const outcome = await syncAll(config, { verbose });

    for (const { folder, result } of outcome.folders) {
      console.log(
        `[${folder.mode}] ${folder.localPath} → ${folder.remotePath} : ${formatResult(result)}`,
      );
      if (verbose || result.errors > 0) {
        for (const detail of result.details) console.log(`  ${detail}`);
      }
    }

    if (once) {
      if (outcome.errors > 0) process.exitCode = 1;
      break;
    }
    if (stopping) break;

    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(0, config.intervalSeconds * 1000 - elapsed));
  } while (!stopping);
}

async function status(parsed: ParsedArgs): Promise<void> {
  const configPath = resolve(stringValue(parsed.values.config) ?? defaultConfigPath());
  const config = loadConfig(configPath);

  console.log(`Configuration : ${configPath}`);
  console.log(`Serveur : ${config.serverUrl}`);
  console.log(`Appareil : ${config.deviceName}`);
  for (const folder of config.folders) {
    const state = loadState(folder.localPath, config.deviceName);
    const count = Object.keys(state.entries).length;
    const last = state.lastSyncAt ?? "jamais";
    const local = existsSync(folder.localPath) ? "présent" : "absent";
    console.log(
      `- ${folder.localPath} → ${folder.remotePath} [${folder.mode}] · ${count} entrée(s) · dernière passe : ${last} · local ${local}`,
    );
  }
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const commandIndex = rawArgs[0] === "--" ? 1 : 0;
  const command = rawArgs[commandIndex] ?? "help";
  const parsed = parseCliArgs(rawArgs.slice(commandIndex + 1));

  if (booleanValue(parsed.values.version) || command === "--version") {
    console.log(VERSION);
    return;
  }
  if (booleanValue(parsed.values.help) || command === "help" || command === "--help") {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "init":
      await init(parsed);
      break;
    case "run":
      await run(parsed);
      break;
    case "status":
      await status(parsed);
      break;
    default:
      console.error(`Commande inconnue : ${command}`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  if (error instanceof SyncApiError) {
    console.error(`Erreur serveur ${error.status} (${error.code}) : ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});

export type { SyncConfig };
