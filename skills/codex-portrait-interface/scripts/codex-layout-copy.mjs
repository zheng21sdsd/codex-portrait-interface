import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { deriveBackgroundTheme, renderBackgroundThemeCss, sanitizeBackgroundImage, summarizeBackgroundTheme } from "./codex-background-theme.mjs";
import { inspectPassiveSkin } from "./codex-passive-skin-check.mjs";

const INTERFACE_VERSION = "0.1.0";
const MANIFEST_SCHEMA_VERSION = 2;
const SUPPORTED_STORE_VERSIONS = new Set(["26.707.3351.0"]);
const STORE_VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[A-F0-9]{64}$/;
const SHORTCUT_DESCRIPTION_PREFIX = "Codex Portrait Interface; install-id=";
const LEGACY_SHORTCUT_DESCRIPTION = "Version-locked passive Codex skin";
const STYLE_MARKER = "./codex-personal.css";
const SCRIPT_MARKER = "./codex-personal.js";
const E2E_MARKER = "[codex-personal-e2e]";

function parseArgs(argv) {
  const options = { action: "status", timeoutMs: 30000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["install", "status", "launch", "preview", "verify", "rollback", "doctor"].includes(arg)) options.action = arg;
    else if (arg === "--help" || arg === "-h") options.action = "help";
    else if (arg === "--background") options.backgroundPath = argv[++index];
    else if (arg === "--portrait") {
      if (options.backgroundPath) throw new Error("Use either --background or the legacy --portrait alias, not both.");
      options.backgroundPath = argv[++index];
      options.legacyPortraitAlias = true;
    } else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--keep-preview") options.keepPreview = true;
    else if (arg === "--allow-unsupported-version") options.allowUnsupportedVersion = true;
    else if (arg === "--json") options.json = true;
    else throw new Error("Unknown argument: " + arg);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 60000) throw new Error("--timeout-ms must be between 1000 and 60000.");
  if (options.backgroundPath === undefined && (argv.includes("--background") || argv.includes("--portrait"))) throw new Error("--background requires a file path.");
  return options;
}

function usage() {
  return [
    "Usage: node scripts/codex-layout-copy.mjs <action> [options]",
    "Actions: doctor, install, status, verify, launch, preview, rollback",
    "Options: --background <image>, --json, --dry-run, --timeout-ms <1000-60000>,",
    "         --keep-preview, --allow-unsupported-version",
    "Layout-copy is experimental, Windows-only, and never modifies the Store installation.",
  ].join("\n");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(result, label, accepted = [0]) {
  if (!accepted.includes(result.status)) throw new Error((label + " failed (" + result.status + ").\n" + (result.stderr || result.stdout)).trim());
}

function systemExecutable(...parts) {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error("SystemRoot is required.");
  return path.join(systemRoot, "System32", ...parts);
}

function powershell(script) {
  return run(systemExecutable("WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script]);
}

function quotePowerShell(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex").toUpperCase();
}

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}

function locateStoreApp() {
  const script = "$p=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1; if(-not $p){exit 2}; [pscustomobject]@{version=$p.Version.ToString(); app=(Join-Path $p.InstallLocation 'app')} | ConvertTo-Json -Compress";
  const result = powershell(script);
  requireSuccess(result, "Locate Codex Store package");
  const info = JSON.parse(result.stdout.trim());
  if (!info.app || !info.version) throw new Error("Codex package metadata is incomplete.");
  if (!STORE_VERSION_PATTERN.test(info.version)) throw new Error("Codex Store package reported an unsafe version string.");
  return info;
}

function assertSupportedStoreVersion(store, allowUnsupportedVersion) {
  if (!SUPPORTED_STORE_VERSIONS.has(store.version) && !allowUnsupportedVersion) {
    throw new Error(`Codex Store version ${store.version} is not in the tested compatibility matrix. Use --allow-unsupported-version only after reviewing the release notes.`);
  }
}

function isPathInside(parent, candidate, allowSame = false) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (allowSame && relative === "") || Boolean(relative) && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

function startMenuProgramsDirectory() {
  const script = "$w=New-Object -ComObject WScript.Shell; [string]$w.SpecialFolders('Programs')";
  const result = powershell(script);
  requireSuccess(result, "Locate Start menu Programs folder");
  const directory = result.stdout.trim();
  if (!directory) throw new Error("Could not locate the Start menu Programs folder.");
  return path.resolve(directory);
}

function getPaths(version) {
  if (!STORE_VERSION_PATTERN.test(version)) throw new Error("Unsafe Codex Store version.");
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("LOCALAPPDATA is required.");
  const base = path.resolve(localAppData, "CodexPortrait");
  return {
    base,
    manifest: path.join(base, "manifest.json"),
    app: path.join(base, version, "app"),
    shortcut: path.join(startMenuProgramsDirectory(), "Codex Personal.lnk"),
  };
}

function runAsar(args) {
  const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const entrypoint = path.join(skillDir, "node_modules", "@electron", "asar", "bin", "asar.mjs");
  if (!existsSync(entrypoint)) throw new Error("Pinned @electron/asar is not installed. Run npm ci in this skill directory before using layout-copy mode.");
  const result = run(process.execPath, [entrypoint, ...args]);
  requireSuccess(result, "asar " + args[0]);
}

function robocopy(source, target) {
  const result = run(systemExecutable("robocopy.exe"), [source, target, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1", "/NP", "/NFL", "/NDL"]);
  requireSuccess(result, "robocopy", [0, 1, 2, 3, 4, 5, 6, 7]);
}

async function validateBackground(backgroundPath) {
  if (!backgroundPath) return null;
  const source = path.resolve(backgroundPath);
  const info = await stat(source);
  const extension = path.extname(source).toLowerCase();
  if (!info.isFile()) throw new Error("Background is not a file: " + source);
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) throw new Error("Background must be PNG, JPEG, or WebP.");
  if (info.size > 50 * 1024 * 1024) throw new Error("Background must be 50 MB or smaller.");
  return { source, extension, bytes: info.size, sha256: await sha256(source) };
}

async function patchWebview(staging, assetDir, background, imageTheme) {
  const webview = path.join(staging, "webview");
  const indexPath = path.join(webview, "index.html");
  let html = await readFile(indexPath, "utf8");
  if (!html.includes(STYLE_MARKER)) html = html.replace("</head>", '  <link rel="stylesheet" href="' + STYLE_MARKER + '" />\n</head>');
  if (!html.includes(SCRIPT_MARKER)) html = html.replace("</head>", '  <script type="module" src="' + SCRIPT_MARKER + '"></script>\n</head>');
  if (!html.includes(STYLE_MARKER) || !html.includes(SCRIPT_MARKER)) throw new Error("Could not patch the Codex webview entrypoint.");
  await writeFile(indexPath, html, "utf8");
  const styleTemplate = await readFile(path.join(assetDir, "codex-personal.css"), "utf8");
  const imageThemeMarker = "/* __CODEX_IMAGE_THEME_OVERRIDES__ */";
  if (!styleTemplate.includes(imageThemeMarker)) throw new Error("Image-theme CSS marker is missing from the layout stylesheet.");
  const stylesheet = styleTemplate.replace(imageThemeMarker, renderBackgroundThemeCss(imageTheme));
  if (stylesheet.includes(imageThemeMarker)) throw new Error("Image-theme CSS marker was not fully replaced.");
  await writeFile(path.join(webview, "codex-personal.css"), stylesheet, "utf8");
  const backgroundAsset = background ? "codex-background.png" : "";
  const scriptTemplate = await readFile(path.join(assetDir, "codex-personal.js"), "utf8");
  if (!scriptTemplate.includes("__CODEX_BACKGROUND_ASSET__")) throw new Error("Background asset token is missing from the layout script.");
  await writeFile(path.join(webview, "codex-personal.js"), scriptTemplate.replaceAll("__CODEX_BACKGROUND_ASSET__", backgroundAsset ? "./" + backgroundAsset : ""), "utf8");
  if (!background) return null;

  const backgroundPath = path.join(webview, backgroundAsset);
  const sanitized = sanitizeBackgroundImage(background.source, backgroundPath);
  if (sanitized.theme.signature !== imageTheme.signature) {
    throw new Error("Background palette changed while the image was being packaged.");
  }
  return {
    asset: backgroundAsset,
    sha256: await sha256(backgroundPath),
    ...sanitized.sanitized,
  };
}

function sameWindowsPath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function readShortcut(shortcut) {
  const script = "$p=" + quotePowerShell(shortcut) + "; if(Test-Path -LiteralPath $p){$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($p); [pscustomobject]@{target=[string]$s.TargetPath;workingDirectory=[string]$s.WorkingDirectory;description=[string]$s.Description}|ConvertTo-Json -Compress}";
  const result = powershell(script);
  requireSuccess(result, "Inspect Start menu shortcut");
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function isRecognizedShortcut(shortcut, executable, workingDirectory) {
  if (!shortcut) return false;
  const pointsToManagedCopy = sameWindowsPath(shortcut.target, executable) && sameWindowsPath(shortcut.workingDirectory, workingDirectory);
  return pointsToManagedCopy && (shortcut.description === LEGACY_SHORTCUT_DESCRIPTION || shortcut.description.startsWith(SHORTCUT_DESCRIPTION_PREFIX));
}

function assertShortcutCanBeManaged(shortcut, executable, workingDirectory) {
  const existing = readShortcut(shortcut);
  if (existing && !isRecognizedShortcut(existing, executable, workingDirectory)) {
    throw new Error(`Refusing to overwrite an unmanaged Start menu shortcut: ${shortcut}`);
  }
  return Boolean(existing);
}

function createShortcut(shortcut, executable, workingDirectory, installId) {
  const replaced = assertShortcutCanBeManaged(shortcut, executable, workingDirectory);
  const description = SHORTCUT_DESCRIPTION_PREFIX + installId;
  const script = "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut(" + quotePowerShell(shortcut) + "); $s.TargetPath=" + quotePowerShell(executable) + "; $s.WorkingDirectory=" + quotePowerShell(workingDirectory) + "; $s.IconLocation=" + quotePowerShell(executable + ",0") + "; $s.Description=" + quotePowerShell(description) + "; $s.Save()";
  requireSuccess(powershell(script), "Create Start menu shortcut");
  return { description, replaced };
}

async function removeOwnedShortcut(shortcut, executable, workingDirectory, installId) {
  const existing = readShortcut(shortcut);
  const expectedDescription = SHORTCUT_DESCRIPTION_PREFIX + installId;
  if (!existing || !installId) return { removed: false, preserved: Boolean(existing) };
  const owned = sameWindowsPath(existing.target, executable) && sameWindowsPath(existing.workingDirectory, workingDirectory) && existing.description === expectedDescription;
  if (!owned) return { removed: false, preserved: true };
  await rm(shortcut, { force: true });
  return { removed: true, preserved: false };
}

function customizedProcessCount(base) {
  const script = "@(Get-CimInstance Win32_Process -Filter \"Name='ChatGPT.exe'\" | Where-Object {$_.ExecutablePath -like " + quotePowerShell(base + "\\*") + "}).Count";
  const result = powershell(script);
  requireSuccess(result, "Check customized Codex processes");
  return Number(result.stdout.trim()) || 0;
}

function publicBackground(background) {
  if (!background) return null;
  return {
    asset: background.asset,
    sha256: background.sha256,
    bytes: background.bytes,
    sourceFormat: background.sourceFormat,
    sanitizedFormat: background.sanitizedFormat,
    width: background.width,
    height: background.height,
  };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { valid: false, reason: "manifest is not an object" };
  if (typeof manifest.packageVersion !== "string" || !STORE_VERSION_PATTERN.test(manifest.packageVersion)) return { valid: false, reason: "manifest packageVersion is invalid" };
  if (manifest.passiveSkin !== true) return { valid: false, reason: "manifest is not marked as a passive skin" };
  if (typeof manifest.customizedAsarSha256 !== "string" || !SHA256_PATTERN.test(manifest.customizedAsarSha256)) return { valid: false, reason: "manifest customized archive hash is invalid" };
  if (typeof manifest.sourceAsarSha256 !== "string" || !SHA256_PATTERN.test(manifest.sourceAsarSha256)) return { valid: false, reason: "manifest source archive hash is invalid" };
  if (manifest.background !== null && manifest.background !== undefined) {
    const background = manifest.background;
    if (!background || typeof background !== "object" || !/^codex-background\.(?:png|jpe?g|webp)$/i.test(background.asset ?? "") || typeof background.sha256 !== "string" || !SHA256_PATTERN.test(background.sha256) || !Number.isFinite(background.bytes) || background.bytes < 1) {
      return { valid: false, reason: "manifest background metadata is invalid" };
    }
  }
  return { valid: true };
}

function runtimeFor(paths) {
  const executable = path.join(paths.app, "ChatGPT.exe");
  return { executable, workingDirectory: paths.app, asarPath: path.join(paths.app, "resources", "app.asar") };
}

function attachRuntime(status, runtime) {
  Object.defineProperty(status, "_runtime", { value: runtime, enumerable: false });
  return status;
}

async function replaceArchive(source, target) {
  const candidate = target + ".next";
  const previous = target + ".previous";
  await copyFile(target, previous);
  try {
    await copyFile(source, candidate);
    if (await sha256(source) !== await sha256(candidate)) throw new Error("Packed archive hash changed before replacement.");
    await rm(target, { force: true });
    await rename(candidate, target);
  } catch (error) {
    if (!(await exists(target)) && await exists(previous)) await rename(previous, target);
    throw error;
  } finally {
    await rm(candidate, { force: true });
    await rm(previous, { force: true });
  }
}

async function isSafeManagedBase(base) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return false;
  const localRoot = path.resolve(localAppData);
  const expected = path.join(localRoot, "CodexPortrait");
  if (!sameWindowsPath(base, expected) || !isPathInside(localRoot, base)) return false;
  try {
    const entry = await lstat(base);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

async function checkPythonPillow() {
  const candidates = process.platform === "win32" ? [["py.exe", ["-3"]], ["python.exe", []]] : [["python3", []], ["python", []]];
  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [...prefix, "-c", "import PIL; print(PIL.__version__)"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return { available: true, version: result.stdout.trim() };
  }
  return { available: false, version: null };
}

async function doctor(options) {
  const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const asarEntrypoint = path.join(skillDir, "node_modules", "@electron", "asar", "bin", "asar.mjs");
  const python = await checkPythonPillow();
  let store = null;
  let storeError = null;
  try { store = locateStoreApp(); } catch (error) { storeError = error.message; }
  const result = {
    status: store && existsSync(asarEntrypoint) && python.available ? "ready" : "needs-setup",
    platform: process.platform,
    layoutCopySupported: process.platform === "win32",
    store: store ? { installed: true, version: store.version, tested: SUPPORTED_STORE_VERSIONS.has(store.version) } : { installed: false, error: storeError },
    dependencies: { node: process.version, asarInstalled: existsSync(asarEntrypoint), pillow: python },
  };
  if (!options.allowUnsupportedVersion && store && !SUPPORTED_STORE_VERSIONS.has(store.version)) result.status = "needs-compatibility-review";
  return result;
}

async function install(options) {
  const store = locateStoreApp();
  assertSupportedStoreVersion(store, options.allowUnsupportedVersion);
  const paths = getPaths(store.version);
  const sourceAsar = path.join(store.app, "resources", "app.asar");
  const runtime = runtimeFor(paths);
  const executable = runtime.executable;
  const targetResources = path.join(paths.app, "resources");
  const targetAsar = path.join(targetResources, "app.asar");
  const backupAsar = path.join(targetResources, "app.asar.store-original");
  const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const assetDir = path.join(skillDir, "assets", "layout");
  const background = await validateBackground(options.backgroundPath);
  const imageTheme = deriveBackgroundTheme(background?.source);
  if (options.dryRun) {
    return {
      status: "dry-run",
      packageVersion: store.version,
      compatibility: { tested: SUPPORTED_STORE_VERSIONS.has(store.version) },
      background: background ? { bytes: background.bytes, sha256: background.sha256 } : null,
      imageTheme: summarizeBackgroundTheme(imageTheme),
      storeInstallationModified: false,
    };
  }
  if (customizedProcessCount(paths.base) > 0) throw new Error("Close Codex Personal before installing its updated skin.");
  assertShortcutCanBeManaged(paths.shortcut, executable, paths.app);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "codex-personal-"));

  try {
    await mkdir(paths.base, { recursive: true });
    if (!(await exists(executable))) robocopy(store.app, paths.app);
    if (!(await exists(backupAsar))) await copyFile(targetAsar, backupAsar);
    const staging = path.join(temporary, "staging");
    const customAsar = path.join(temporary, "app.asar");
    await mkdir(staging, { recursive: true });
    runAsar(["extract", sourceAsar, staging]);
    const packagedBackground = await patchWebview(staging, assetDir, background, imageTheme);
    runAsar(["pack", staging, customAsar, "--unpack-dir", "{node_modules/@worklouder,node_modules/better-sqlite3,node_modules/node-pty}"]);
    await replaceArchive(customAsar, targetAsar);
    const unpacked = customAsar + ".unpacked";
    if (await exists(unpacked)) robocopy(unpacked, path.join(targetResources, "app.asar.unpacked"));
    const installId = randomUUID();
    const shortcut = createShortcut(paths.shortcut, executable, paths.app, installId);
    const manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      interfaceVersion: INTERFACE_VERSION,
      passiveSkin: true,
      installId,
      packageVersion: store.version,
      sourceAsarSha256: await sha256(sourceAsar),
      customizedAsarSha256: await sha256(targetAsar),
      background: packagedBackground,
      imageTheme: summarizeBackgroundTheme(imageTheme),
      installedAt: new Date().toISOString(),
    };
    await writeFile(paths.manifest, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    return {
      status: "installed",
      interfaceVersion: manifest.interfaceVersion,
      packageVersion: manifest.packageVersion,
      passiveSkin: true,
      background: publicBackground(manifest.background),
      imageTheme: manifest.imageTheme,
      shortcut: { managed: true, replaced: shortcut.replaced },
      storeInstallationModified: false,
      legacyPortraitAliasUsed: Boolean(options.legacyPortraitAlias),
    };
  } finally {
    const resolvedTemp = path.resolve(temporary);
    if (!resolvedTemp.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe temporary cleanup path.");
    await rm(resolvedTemp, { recursive: true, force: true });
  }
}

async function readStatus() {
  const store = locateStoreApp();
  const currentPaths = getPaths(store.version);
  const sourceAsar = path.join(store.app, "resources", "app.asar");
  if (!(await exists(currentPaths.manifest))) {
    return { status: "not-installed", currentStoreVersion: store.version, compatibility: { tested: SUPPORTED_STORE_VERSIONS.has(store.version) } };
  }
  let manifest;
  try { manifest = JSON.parse(await readFile(currentPaths.manifest, "utf8")); } catch (error) {
    return { status: "damaged", currentStoreVersion: store.version, reason: "manifest could not be parsed", compatibility: { tested: SUPPORTED_STORE_VERSIONS.has(store.version) } };
  }
  const manifestCheck = validateManifest(manifest);
  if (!manifestCheck.valid) {
    return { status: "damaged", currentStoreVersion: store.version, reason: manifestCheck.reason, compatibility: { tested: SUPPORTED_STORE_VERSIONS.has(store.version) } };
  }
  const installedPaths = getPaths(manifest.packageVersion);
  const runtime = runtimeFor(installedPaths);
  const installed = await exists(runtime.executable) && await exists(runtime.asarPath);
  const actualAsarSha256 = installed ? await sha256(runtime.asarPath) : null;
  const actualSourceAsarSha256 = await sha256(sourceAsar);
  const shortcut = readShortcut(installedPaths.shortcut);
  const status = {
    status: installed && actualAsarSha256 === manifest.customizedAsarSha256 ? "installed" : "damaged",
    interfaceVersion: manifest.interfaceVersion,
    passiveSkin: manifest.passiveSkin === true,
    installedVersion: manifest.packageVersion,
    currentStoreVersion: store.version,
    updateAvailable: manifest.packageVersion !== store.version,
    compatibility: { tested: SUPPORTED_STORE_VERSIONS.has(store.version) },
    manifestSchemaVersion: manifest.schemaVersion ?? 1,
    legacyManifest: !manifest.schemaVersion,
    shortcut: { managed: isRecognizedShortcut(shortcut, runtime.executable, runtime.workingDirectory) },
    customizedAsarSha256: manifest.customizedAsarSha256,
    actualAsarSha256,
    sourceAsarSha256: manifest.sourceAsarSha256,
    actualSourceAsarSha256,
    sourceAsarMatches: actualSourceAsarSha256 === manifest.sourceAsarSha256,
    background: publicBackground(manifest.background),
    imageTheme: manifest.imageTheme ?? null,
  };
  return attachRuntime(status, { ...runtime, paths: installedPaths, installId: manifest.installId ?? null });
}

async function inspectArchive(status) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "codex-personal-verify-"));
  try {
    const asarPath = status._runtime.asarPath;
    const staging = path.join(temporary, "staging");
    runAsar(["extract", asarPath, staging]);
    const webview = path.join(staging, "webview");
    const index = await readFile(path.join(webview, "index.html"), "utf8");
    const stylesheet = await readFile(path.join(webview, "codex-personal.css"), "utf8");
    const assetPath = status.background?.asset ? path.join(webview, status.background.asset) : null;
    const staticSafety = await inspectPassiveSkin(webview, { backgroundPath: assetPath ?? undefined });
    const assetPresent = assetPath ? await exists(assetPath) : true;
    const assetHashMatches = assetPath && assetPresent ? await sha256(assetPath) === status.background.sha256 : !assetPath;
    const entrypointPatched = index.includes(STYLE_MARKER) && index.includes(SCRIPT_MARKER) && !index.includes("codex-personal-home.css");
    const imageTheme = {
      metadataPresent: Boolean(status.imageTheme),
      requested: Boolean(status.background),
      derived: status.imageTheme?.derived === true,
      signatureMatches: Boolean(status.imageTheme?.signature && stylesheet.includes("--personal-image-theme-signature: " + status.imageTheme.signature + " !important;")),
    };
    const imageThemePass = imageTheme.metadataPresent && imageTheme.signatureMatches && (!imageTheme.requested || imageTheme.derived);
    return {
      status: staticSafety.status === "passed" && entrypointPatched && assetPresent && assetHashMatches && imageThemePass ? "passed" : "failed",
      entrypointPatched,
      background: { requested: Boolean(status.background), assetPresent, assetHashMatches },
      imageTheme,
      staticSafety,
    };
  } finally {
    const resolvedTemp = path.resolve(temporary);
    if (!resolvedTemp.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe verification cleanup path.");
    await rm(resolvedTemp, { recursive: true, force: true });
  }
}

async function spawnPreview(status, label) {
  const paths = getPaths(status.currentStoreVersion);
  const suffix = label === "preview" ? "" : "-" + Date.now();
  const profile = path.join(paths.base, label + "-profile" + suffix);
  const log = path.join(paths.base, label + "-runtime" + suffix + ".log");
  await mkdir(profile, { recursive: true });
  await writeFile(log, "", "utf8");
  const child = spawn(status._runtime.executable, ["--user-data-dir=" + profile, "--enable-logging", "--log-file=" + log], {
    cwd: status._runtime.workingDirectory,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return { status: label + "-launched", profile, log, pid: child.pid };
}

function latestEvidence(text) {
  let settled = null;
  let latest = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = line.indexOf(E2E_MARKER);
    if (marker < 0) continue;
    try {
      const payload = line.slice(marker + E2E_MARKER.length).trim();
      const json = payload.match(/\{.*\}/)?.[0] ?? payload;
      const evidence = JSON.parse(json);
      latest = evidence;
      if (evidence.settled) settled = evidence;
    } catch { /* Ignore non-JSON Chromium log decoration. */ }
  }
  return settled ?? latest;
}

async function waitForEvidence(log, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let evidence = null;
  while (Date.now() < deadline) {
    if (await exists(log)) evidence = latestEvidence(await readFile(log, "utf8")) ?? evidence;
    if (evidence?.settled) return { status: "received", evidence };
    await delay(250);
  }
  return { status: "timed-out", evidence };
}

function processEvidence(pid) {
  const script = "$p=Get-Process -Id " + pid + " -ErrorAction SilentlyContinue; if($p){[pscustomobject]@{running=$true; mainWindowHandle=[int64]$p.MainWindowHandle} | ConvertTo-Json -Compress}else{[pscustomobject]@{running=$false; mainWindowHandle=0} | ConvertTo-Json -Compress}";
  const result = powershell(script);
  requireSuccess(result, "Inspect preview process");
  return JSON.parse(result.stdout.trim());
}

function stopPreview(pid) {
  const script = "$p=Get-Process -Id " + pid + " -ErrorAction SilentlyContinue; if($p){Stop-Process -Id " + pid + " -Force; 'stopped'}else{'not-running'}";
  const result = powershell(script);
  requireSuccess(result, "Stop isolated verification preview");
  return result.stdout.trim();
}

async function cleanupPreview(paths, preview) {
  if (!isPathInside(paths.base, preview.profile) || !isPathInside(paths.base, preview.log)) throw new Error("Unsafe preview cleanup path.");
  const process = processEvidence(preview.pid);
  const stopped = process.running ? stopPreview(preview.pid) : "not-running";
  await rm(preview.profile, { recursive: true, force: true });
  await rm(preview.log, { force: true });
  return { stopped, cleaned: true };
}

function rendererPassed(evidence) {
  const safety = evidence?.passiveSafety;
  if (!evidence?.settled || !evidence.background?.loaded || !safety) return false;
  if (!safety.layerExists || !safety.ariaHidden || !safety.layerPointerEventsNone || !safety.noFocusableDescendants || !safety.focusUnchanged || !safety.customLayerBelowRoot || !safety.rootGeometry) return false;
  if (safety.imageTheme?.status !== "passed") return false;
  if (safety.readability?.status !== "passed") return false;
  if (safety.nativeSurfaceTheme?.status === "failed") return false;
  if (safety.nativeTargets?.generic?.status !== "passed") return false;
  const sidebarIcons = safety.sidebarIconTheme;
  if (sidebarIcons?.status !== "passed" || sidebarIcons.variants?.regular?.status !== "passed") return false;
  if (Object.values(sidebarIcons.variants).some((variant) => variant.status === "failed")) return false;
  return [...Object.values(safety.nativeTargets), ...Object.values(safety.overlays)].every((item) => item.status === undefined ? item !== "failed" : item.status !== "failed");
}

async function verify(options) {
  const status = await readStatus();
  if (!status.compatibility?.tested && !options.allowUnsupportedVersion) {
    return { status: "failed", package: { compatibility: "unsupported" }, limitations: ["This Store version is outside the tested compatibility matrix. Review it and pass --allow-unsupported-version only for a deliberate experimental run."] };
  }
  const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const staticSafety = await inspectPassiveSkin(path.join(skillDir, "assets", "layout"));
  const packageChecks = status.status === "installed" ? await inspectArchive(status) : { status: "not-run" };
  const hashesPass = status.status === "installed" && status.sourceAsarMatches && !status.updateAvailable;
  const preflightPass = hashesPass && staticSafety.status === "passed" && packageChecks.status === "passed";
  const preview = preflightPass ? await spawnPreview(status, "e2e") : null;
  const runtime = preview ? await waitForEvidence(preview.log, options.timeoutMs) : { status: "not-run" };
  const process = preview ? processEvidence(preview.pid) : null;
  const rendererPass = runtime.status === "received" && rendererPassed(runtime.evidence);
  const cleanup = preview && !options.keepPreview ? await cleanupPreview(status._runtime.paths, preview) : { retained: Boolean(preview) };
  return {
    status: preflightPass && rendererPass ? "verified" : "failed",
    package: {
      customHashMatch: status.status === "installed",
      storeHashMatch: status.sourceAsarMatches === true,
      updateAvailable: status.updateAvailable,
      archive: packageChecks,
    },
    staticSafety,
    renderer: runtime.evidence ?? null,
    runtime: { status: runtime.status, preview: preview ? { pid: preview.pid, retained: Boolean(options.keepPreview) } : null, process, cleanup },
    limitations: [
      "Codex UI automation and screenshots are prohibited, so route-specific right-panel, menu, and dialog coverage is reported as passed, failed, or not-exercised by the renderer.",
      "Visual styling still requires the user's confirmation in their normal Codex Personal profile.",
    ],
  };
}

async function launch() {
  const status = await readStatus();
  if (status.status !== "installed") throw new Error("Customized Codex is " + status.status + "; run install first.");
  const child = spawn(status._runtime.executable, [], { cwd: status._runtime.workingDirectory, detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { status: "launched", note: "Close the Store Codex first if its single-instance lock redirects this launch." };
}

async function preview() {
  const status = await readStatus();
  if (status.status !== "installed") throw new Error("Customized Codex is " + status.status + "; run install first.");
  const result = await spawnPreview(status, "preview");
  return { ...result, note: "This isolated preview does not reuse the normal Codex session data." };
}

async function rollback() {
  const status = await readStatus();
  if (!status._runtime) throw new Error("Refusing rollback because the managed manifest is missing or invalid.");
  const paths = status._runtime.paths;
  const base = path.resolve(paths.base);
  if (!(await isSafeManagedBase(base))) throw new Error("Unsafe rollback path.");
  if (customizedProcessCount(base) > 0) throw new Error("Close Codex Personal before rollback.");
  const shortcut = await removeOwnedShortcut(paths.shortcut, status._runtime.executable, status._runtime.workingDirectory, status._runtime.installId);
  if (await exists(base)) await rm(base, { recursive: true, force: true });
  return { status: "rolled-back", shortcut, storeInstallationModified: false };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.action === "help") {
    console.log(usage());
    return;
  }
  if (process.platform !== "win32") throw new Error("Layout-copy mode currently supports Windows only.");
  const result = options.action === "doctor" ? await doctor(options)
    : options.action === "install" ? await install(options)
    : options.action === "launch" ? await launch()
      : options.action === "preview" ? await preview()
        : options.action === "verify" ? await verify(options)
          : options.action === "rollback" ? await rollback()
            : await readStatus();
  console.log(JSON.stringify(result, null, options.json ? 2 : 0));
  if ((options.action === "verify" && result.status !== "verified") || (options.action === "doctor" && result.status !== "ready")) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
