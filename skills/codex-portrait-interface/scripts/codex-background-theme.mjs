import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessThemeReadability } from "./codex-theme-readability.mjs";

const SCHEMA = "codex-background-theme/v1";
const CSS_TOKEN_NAMES = [
  "--personal-canvas", "--personal-chrome", "--personal-sidebar", "--personal-surface", "--personal-surface-strong",
  "--personal-lilac", "--personal-mint", "--personal-teal", "--personal-teal-hover", "--personal-blue", "--personal-purple",
  "--personal-pink", "--personal-file", "--personal-text", "--personal-muted", "--personal-line", "--personal-line-strong",
  "--personal-image-scrim", "--personal-image-scrim-middle", "--personal-image-scrim-end", "--personal-image-top-scrim",
  "--personal-image-bottom-scrim", "--personal-image-opacity", "--personal-image-saturation", "--personal-image-contrast",
  "--personal-image-brightness", "--personal-workbench-blush", "--personal-workbench-gold", "--personal-workbench-end",
  "--personal-sidebar-surface", "--personal-main-surface", "--personal-panel-surface", "--personal-conversation-surface",
  "--personal-conversation-header", "--personal-reading-surface", "--personal-input-surface", "--personal-secondary-surface", "--personal-hover-surface",
  "--personal-active-surface", "--personal-disabled-surface", "--personal-disabled-text", "--personal-on-active-surface", "--personal-on-accent",
  "--personal-focus-ring", "--personal-focus-glow", "--personal-dialog-surface", "--personal-shadow",
  "--personal-elevation-shadow", "--personal-code-surface", "--personal-terminal-surface", "--personal-terminal-foreground", "--personal-scrollbar",
  "--personal-scrollbar-hover", "--personal-selection", "--personal-added", "--personal-removed", "--personal-sidebar-icon-rest",
  "--personal-sidebar-icon-project", "--personal-sidebar-icon-thread", "--personal-sidebar-icon-file", "--personal-sidebar-icon-hover",
  "--personal-sidebar-icon-active", "--personal-sidebar-icon-muted",
];
const SAFE_CSS_VALUE = /^[#\w\s(),.%/.-]+$/;

const FALLBACK_TOKENS = {
  "--personal-canvas": "#fff8f5",
  "--personal-chrome": "#fff0f1",
  "--personal-sidebar": "#ffeaed",
  "--personal-surface": "rgb(255 253 252 / 0.70)",
  "--personal-surface-strong": "#fffdfc",
  "--personal-lilac": "#f7dfe7",
  "--personal-mint": "#f7e8c9",
  "--personal-teal": "#a95d77",
  "--personal-teal-hover": "#7e4058",
  "--personal-blue": "#4e687f",
  "--personal-purple": "#a95d77",
  "--personal-pink": "#a95d77",
  "--personal-file": "#4e687f",
  "--personal-text": "#27313f",
  "--personal-muted": "#786f79",
  "--personal-line": "#edc9d1",
  "--personal-line-strong": "#d69cac",
  "--personal-image-scrim": "rgb(255 248 245 / 0.11)",
  "--personal-image-scrim-middle": "rgb(255 255 255 / 0.02)",
  "--personal-image-scrim-end": "rgb(250 229 235 / 0.14)",
  "--personal-image-top-scrim": "rgb(255 255 255 / 0.06)",
  "--personal-image-bottom-scrim": "rgb(255 248 245 / 0.18)",
  "--personal-image-opacity": "0.54",
  "--personal-image-saturation": "1.08",
  "--personal-image-contrast": "1.06",
  "--personal-image-brightness": "0.86",
  "--personal-workbench-blush": "rgb(226 143 161 / 0.34)",
  "--personal-workbench-gold": "rgb(222 181 104 / 0.30)",
  "--personal-workbench-end": "#fff0f1",
  "--personal-sidebar-surface": "#fff0f2",
  "--personal-main-surface": "rgb(255 248 245 / 0.16)",
  "--personal-panel-surface": "#fffaf9",
  "--personal-conversation-surface": "#fffdfc",
  "--personal-conversation-header": "#fff3f4",
  "--personal-reading-surface": "#fffdfc",
  "--personal-input-surface": "#fffdfc",
  "--personal-secondary-surface": "rgb(247 232 201 / 0.72)",
  "--personal-hover-surface": "#fae8ec",
  "--personal-active-surface": "#f4d7df",
  "--personal-disabled-surface": "#f7edf0",
  "--personal-disabled-text": "#655d67",
  "--personal-on-active-surface": "#27313f",
  "--personal-on-accent": "#ffffff",
  "--personal-focus-ring": "#a95d77",
  "--personal-focus-glow": "rgb(226 143 161 / 0.20)",
  "--personal-dialog-surface": "#fffdfc",
  "--personal-shadow": "rgb(39 49 63 / 0.13)",
  "--personal-elevation-shadow": "rgb(39 49 63 / 0.17)",
  "--personal-code-surface": "#fffdfc",
  "--personal-terminal-surface": "#242735",
  "--personal-terminal-foreground": "#fff8f5",
  "--personal-scrollbar": "rgb(169 93 119 / 0.44)",
  "--personal-scrollbar-hover": "rgb(226 143 161 / 0.56)",
  "--personal-selection": "rgb(226 143 161 / 0.34)",
  "--personal-added": "#3b8f70",
  "--personal-removed": "#a95d77",
  "--personal-sidebar-icon-rest": "#4e687f",
  "--personal-sidebar-icon-project": "#a37a43",
  "--personal-sidebar-icon-thread": "#a95d77",
  "--personal-sidebar-icon-file": "#4e687f",
  "--personal-sidebar-icon-hover": "#9c4e6a",
  "--personal-sidebar-icon-active": "#7e4058",
  "--personal-sidebar-icon-muted": "#786f79",
};

function pythonScriptPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "derive-background-theme.py");
}

function runPython(backgroundPath, { sanitizeOutput } = {}) {
  const candidates = [
    ["python.exe", []],
    ["python", []],
    ["py.exe", ["-3"]],
    ["py", ["-3"]],
  ];
  let failure = "Python with Pillow is required to derive an image palette.";
  for (const [command, prefix] of candidates) {
    const args = [...prefix, pythonScriptPath(), backgroundPath];
    if (sanitizeOutput) args.push("--sanitize-output", sanitizeOutput);
    args.push("--json");
    const result = spawnSync(command, args, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!result.error && result.status === 0) return result.stdout;
    if (result.stderr?.trim()) failure = result.stderr.trim();
  }
  throw new Error("Could not derive a background palette. " + failure);
}

function assertTheme(theme) {
  if (!theme || theme.schema !== SCHEMA || typeof theme.derived !== "boolean" || typeof theme.signature !== "string") {
    throw new Error("Background palette extractor returned an invalid theme payload.");
  }
  if (!theme.tokens || typeof theme.tokens !== "object") throw new Error("Background palette extractor returned no CSS tokens.");
  for (const name of CSS_TOKEN_NAMES) {
    const value = theme.tokens[name];
    if (typeof value !== "string" || !SAFE_CSS_VALUE.test(value)) throw new Error("Background palette token is unsafe or missing: " + name);
  }
  const readability = assessThemeReadability(theme.tokens);
  if (readability.status !== "passed") {
    throw new Error("Background palette is not readable: " + readability.failures.map((failure) => failure.name).join(", "));
  }
  return theme;
}

function fallbackTheme() {
  return {
    schema: SCHEMA,
    algorithm: "warm-fallback-readable-v2",
    derived: false,
    signature: "warm-fallback-v1",
    width: 0,
    height: 0,
    sampleCount: 0,
    swatches: { ink: "#27313f", blush: "#e28fa1", gold: "#deb568", cool: "#4e687f", light: "#fff8f5" },
    tokens: FALLBACK_TOKENS,
  };
}

export function deriveBackgroundTheme(backgroundPath) {
  if (!backgroundPath) return fallbackTheme();
  return assertTheme(JSON.parse(runPython(backgroundPath)));
}

export function sanitizeBackgroundImage(backgroundPath, outputPath) {
  const payload = assertTheme(JSON.parse(runPython(backgroundPath, { sanitizeOutput: outputPath })));
  const sanitized = payload.sanitized;
  if (!sanitized || sanitized.sanitizedFormat !== "PNG" || !Number.isInteger(sanitized.bytes) || sanitized.bytes < 1) {
    throw new Error("Background sanitizer returned invalid metadata.");
  }
  return { theme: payload, sanitized };
}

export function renderBackgroundThemeCss(theme) {
  const checked = assertTheme(theme) || theme;
  const declarations = CSS_TOKEN_NAMES.map((name) => `  ${name}: ${checked.tokens[name]} !important;`);
  return [
    "/* codex-personal-image-theme:start */",
    "html[data-codex-personal-interface] {",
    `  --personal-image-theme-derived: ${checked.derived ? "1" : "0"} !important;`,
    `  --personal-image-theme-algorithm: ${checked.algorithm} !important;`,
    `  --personal-image-theme-signature: ${checked.signature} !important;`,
    ...declarations,
    "}",
    "/* codex-personal-image-theme:end */",
  ].join("\n");
}

export function summarizeBackgroundTheme(theme) {
  const checked = assertTheme(theme) || theme;
  return {
    schema: checked.schema,
    algorithm: checked.algorithm,
    derived: checked.derived,
    signature: checked.signature,
    width: checked.width,
    height: checked.height,
    sampleCount: checked.sampleCount,
    swatches: checked.swatches,
  };
}

async function main() {
  const [flag, backgroundPath, jsonFlag] = process.argv.slice(2);
  if (flag !== "--background" || !backgroundPath || (jsonFlag && jsonFlag !== "--json")) {
    throw new Error("Usage: node codex-background-theme.mjs --background <absolute-image-path> [--json]");
  }
  console.log(JSON.stringify(deriveBackgroundTheme(backgroundPath), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
