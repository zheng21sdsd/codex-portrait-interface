import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const THEME_KEYS = {
  appearanceTheme: "desktop.appearanceTheme",
  lightChromeTheme: "desktop.appearanceLightChromeTheme",
  darkChromeTheme: "desktop.appearanceDarkChromeTheme",
  lightCodeThemeId: "desktop.appearanceLightCodeThemeId",
  darkCodeThemeId: "desktop.appearanceDarkCodeThemeId",
  sansFontSize: "desktop.sansFontSize",
  codeFontSize: "desktop.codeFontSize",
};
const THEME_STATE_VERSION = 1;

function parseArgs(argv) {
  const options = { action: "status" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["status", "apply", "rollback"].includes(arg)) options.action = arg;
    else if (arg === "--help" || arg === "-h") options.action = "help";
    else if (arg === "--theme") options.themePath = argv[++index];
    else if (arg === "--codex") options.codexPath = argv[++index];
    else if (arg === "--config") options.configPath = argv[++index];
    else if (arg === "--force") options.force = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/codex-theme.mjs <status|apply|rollback> [options]",
    "Options: --theme <theme.json>, --codex <codex.exe>, --json, --force",
    "Rollback refuses to overwrite config.toml if it changed after apply; --force overrides that guard.",
  ].join("\n");
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex").toUpperCase();
}

function resolveConfigPath(codexHome, requestedPath) {
  const expected = path.resolve(codexHome, "config.toml");
  const selected = path.resolve(requestedPath || expected);
  if (selected !== expected) throw new Error("--config is limited to the active CODEX_HOME config.toml for safety.");
  return expected;
}

async function readState(statePath) {
  try { return JSON.parse(await readFile(statePath, "utf8")); } catch { return null; }
}

function findCodexCli(explicitPath) {
  const candidates = [explicitPath, process.env.CODEX_CLI_PATH].filter(Boolean);
  if (process.platform === "win32") {
    const where = spawnSync("where.exe", ["codex.exe"], { encoding: "utf8" });
    if (where.status === 0) candidates.push(...where.stdout.split(/\r?\n/).filter(Boolean));

    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
      const search = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `Get-ChildItem -LiteralPath '${binRoot.replaceAll("'", "''")}' -Filter codex.exe -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -ExpandProperty FullName`],
        { encoding: "utf8" },
      );
      if (search.status === 0) candidates.push(...search.stdout.split(/\r?\n/).filter(Boolean));
    }
  } else {
    const which = spawnSync("which", ["codex"], { encoding: "utf8" });
    if (which.status === 0) candidates.push(which.stdout.trim());
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const check = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (check.status === 0) return candidate;
  }
  throw new Error("Could not locate a working Codex CLI. Pass --codex <path>.");
}

class AppServerClient {
  constructor(codexPath) {
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.process = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk) => { this.stderr = (this.stderr + chunk).slice(-4000); });

    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === undefined) return;
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    this.process.on("exit", (code) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`Codex app-server exited with code ${code}. ${this.stderr}`.trim()));
      }
      this.pending.clear();
    });
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: { name: "codex-desktop-theme", title: "Codex Desktop Theme", version: "1.0.0" },
      capabilities: null,
    });
  }

  request(method, params) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Timed out waiting for ${method}. ${this.stderr}`.trim()));
      }, 15000);
      this.pending.set(String(id), {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
    });
    this.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    return promise;
  }

  close() {
    this.process.stdin.end();
  }
}

function validateTheme(theme) {
  if (!["system", "light", "dark"].includes(theme.appearanceTheme)) {
    throw new Error("appearanceTheme must be system, light, or dark.");
  }
  for (const variant of [theme.lightChromeTheme, theme.darkChromeTheme]) {
    if (!variant || !Number.isInteger(variant.contrast) || variant.contrast < 0 || variant.contrast > 100) {
      throw new Error("Each theme variant needs an integer contrast from 0 to 100.");
    }
    for (const color of [variant.accent, variant.ink, variant.surface, ...Object.values(variant.semanticColors ?? {})]) {
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid theme color: ${color}`);
    }
  }
}

function selectAppearance(config) {
  const desktop = config?.desktop ?? {};
  return Object.fromEntries(Object.entries(THEME_KEYS).map(([name, keyPath]) => [name, desktop[keyPath.split(".")[1]] ?? null]));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.action === "help") {
    console.log(usage());
    return;
  }
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = resolveConfigPath(codexHome, options.configPath);
  const backupDir = path.join(codexHome, "backups", "codex-desktop-theme");
  const backupPath = path.join(backupDir, "config.before-theme.toml");
  const statePath = path.join(backupDir, "theme-state.json");

  if (options.action === "rollback") {
    await stat(backupPath);
    const state = await readState(statePath);
    if (!state || state.schemaVersion !== THEME_STATE_VERSION || typeof state.afterConfigSha256 !== "string") {
      throw new Error("No safe theme rollback state was found. Restore the backup manually after reviewing it.");
    }
    const currentConfigSha256 = await sha256(configPath);
    if (currentConfigSha256 !== state.afterConfigSha256 && !options.force) {
      throw new Error("config.toml changed after the theme was applied; rollback refused to avoid overwriting your newer settings. Review the backup or re-run with --force.");
    }
    await copyFile(backupPath, configPath);
    await rm(backupPath, { force: true });
    await rm(statePath, { force: true });
    console.log(JSON.stringify({ status: "rolled-back", restartRequired: true, forced: Boolean(options.force) }, null, options.json ? 2 : 0));
    return;
  }

  const codexPath = findCodexCli(options.codexPath);
  const client = new AppServerClient(codexPath);
  try {
    await client.initialize();
    if (options.action === "status") {
      const result = await client.request("config/read", { includeLayers: false });
      const state = await readState(statePath);
      const currentConfigSha256 = await sha256(configPath);
      console.log(JSON.stringify({
        status: "ok",
        appearance: selectAppearance(result.config),
        rollback: state ? { available: true, safeToApply: currentConfigSha256 === state.afterConfigSha256 } : { available: false },
      }, null, options.json ? 2 : 0));
      return;
    }

    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const themePath = path.resolve(options.themePath || path.join(scriptDir, "..", "assets", "default-theme.json"));
    const theme = JSON.parse(await readFile(themePath, "utf8"));
    validateTheme(theme);
    await mkdir(backupDir, { recursive: true });
    const before = await client.request("config/read", { includeLayers: false });
    await copyFile(configPath, backupPath);

    const edits = Object.entries(THEME_KEYS).map(([name, keyPath]) => ({
      keyPath,
      value: theme[name],
      mergeStrategy: "replace",
    }));
    const write = await client.request("config/batchWrite", {
      edits,
      filePath: configPath,
      expectedVersion: before.version ?? null,
      reloadUserConfig: true,
    });
    const result = await client.request("config/read", { includeLayers: false });
    const state = {
      schemaVersion: THEME_STATE_VERSION,
      appliedAt: new Date().toISOString(),
      beforeAppearance: selectAppearance(before.config),
      afterAppearance: selectAppearance(result.config),
      beforeConfigSha256: await sha256(backupPath),
      afterConfigSha256: await sha256(configPath),
    };
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ status: "applied", write, appearance: state.afterAppearance, rollback: { available: true, guarded: true }, restartRequired: true }, null, options.json ? 2 : 0));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
