import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveBackgroundTheme } from "./codex-background-theme.mjs";
import { assessThemeReadability } from "./codex-theme-readability.mjs";

const REQUIRED_FILES = ["codex-personal.js", "codex-personal.css"];
const FORBIDDEN_JAVASCRIPT = [
  ["programmatic click", /\.click\s*\(/],
  ["programmatic focus", /\.focus\s*\(/],
  ["editor command", /\bexecCommand\s*\(/],
  ["synthetic input event", /\bInputEvent\s*\(/],
  ["synthetic event dispatch", /\.dispatchEvent\s*\(/],
  ["custom click listener", /addEventListener\s*\(\s*["']click["']/],
  ["custom button", /createElement\s*\(\s*["']button["']/],
  ["preset interaction", /\b(?:PRESETS|activatePreset|data-preset)\b/],
];
const FORBIDDEN_CSS = [
  ["interactive theme CSS", /pointer-events\s*:\s*auto/i],
  ["high theme z-index", /z-index\s*:\s*(?!0\b)\d+/i],
  ["native layout override", /(?:^|})\s*(?:html|body|#root)[^{]*\{[^}]*\b(?:display|position|inset|overflow|width|min-width|height|min-height|z-index|pointer-events)\s*:/is],
  ["home-page overlay", /(?:theme-page|home-hero|preset-grid|personal-polaroid)/i],
];
const SIDEBAR_ICON_SKIN_START = "/* codex-personal-sidebar-icon-skin:start */";
const SIDEBAR_ICON_SKIN_END = "/* codex-personal-sidebar-icon-skin:end */";
const FILE_TREE_ICON_SKIN_START = "/* codex-personal-file-tree-icon-skin:start */";
const FILE_TREE_ICON_SKIN_END = "/* codex-personal-file-tree-icon-skin:end */";
const IMAGE_THEME_TEMPLATE_MARKER = "/* __CODEX_IMAGE_THEME_OVERRIDES__ */";
const IMAGE_THEME_START = "/* codex-personal-image-theme:start */";
const IMAGE_THEME_END = "/* codex-personal-image-theme:end */";
const IMAGE_THEME_TOKENS = [
  "--personal-canvas", "--personal-sidebar", "--personal-input-surface", "--personal-reading-surface", "--personal-disabled-surface",
  "--personal-disabled-text", "--personal-on-active-surface", "--personal-terminal-surface", "--personal-terminal-foreground", "--personal-image-opacity",
  "--personal-sidebar-icon-rest", "--personal-sidebar-icon-project", "--personal-sidebar-icon-thread",
  "--personal-sidebar-icon-file", "--personal-sidebar-icon-hover", "--personal-sidebar-icon-active",
  "--personal-sidebar-icon-muted",
];

function matches(source, rules) {
  return rules.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

function inspectSidebarIconSkin(css) {
  const start = css.indexOf(SIDEBAR_ICON_SKIN_START);
  const end = css.indexOf(SIDEBAR_ICON_SKIN_END);
  const errors = [];
  if (start < 0 || end < 0 || end <= start) {
    return { errors: ["Sidebar icon skin markers are missing or malformed."], present: false };
  }

  const block = css.slice(start + SIDEBAR_ICON_SKIN_START.length, end);
  const required = [
    ["regular sidebar anchor", /aside\.app-shell-left-panel/],
    ["floating sidebar anchor", /aside\[data-testid\s*=\s*["']app-shell-floating-left-panel["']\]/i],
    ["project icon anchor", /\[data-sidebar-project-drop-zone\s*=\s*["']project-icon["']\]\[data-sidebar-project-kind\]/i],
    ["project or folder icon color", /data-sidebar-project-kind[\s\S]*?color\s*:\s*var\(--personal-sidebar-icon-project\)\s*!important/i],
    ["conversation icon anchor", /\[data-thread-title\]/i],
    ["conversation icon color", /data-thread-title[\s\S]*?color\s*:\s*var\(--personal-sidebar-icon-thread\)\s*!important/i],
    ["rest icon color", /color\s*:\s*var\(--personal-sidebar-icon-rest\)\s*!important/i],
    ["hover icon color", /:hover[\s\S]*?color\s*:\s*var\(--personal-sidebar-icon-hover\)\s*!important/i],
    ["active icon color", /\[aria-current\s*=\s*["']page["']\][\s\S]*?color\s*:\s*var\(--personal-sidebar-icon-active\)\s*!important/i],
    ["disabled icon color", /\[aria-disabled\s*=\s*["']true["']\][\s\S]*?color\s*:\s*var\(--personal-sidebar-icon-muted\)\s*!important/i],
  ];
  for (const [name, pattern] of required) {
    if (!pattern.test(block)) errors.push(`Sidebar icon skin is missing ${name}.`);
  }

  const declarations = [...block.matchAll(/(?:^|[;{])\s*([\w-]+)\s*:/gm)].map((match) => match[1]);
  const nonColorDeclarations = declarations.filter((property) => property !== "color");
  if (nonColorDeclarations.length) {
    errors.push(`Sidebar icon skin must only set color; found ${[...new Set(nonColorDeclarations)].join(", ")}.`);
  }
  if (/::(?:before|after)\b/i.test(block)) {
    errors.push("Sidebar icon skin must not use pseudo-elements.");
  }
  return { errors, present: true };
}

function inspectFileTreeIconSkin(css) {
  const start = css.indexOf(FILE_TREE_ICON_SKIN_START);
  const end = css.indexOf(FILE_TREE_ICON_SKIN_END);
  const errors = [];
  if (start < 0 || end < 0 || end <= start) {
    return { errors: ["File-tree icon skin markers are missing or malformed."], present: false };
  }

  const block = css.slice(start + FILE_TREE_ICON_SKIN_START.length, end);
  const required = [
    ["regular sidebar anchor", /aside\.app-shell-left-panel/],
    ["floating sidebar anchor", /aside\[data-testid\s*=\s*["']app-shell-floating-left-panel["']\]/i],
    ["file-tree host", /file-tree-container/i],
    ["foreground override", /--trees-fg-override\s*:/i],
    ["muted override", /--trees-fg-muted-override\s*:/i],
    ["accent override", /--trees-accent-override\s*:/i],
    ["selected foreground override", /--trees-selected-fg-override\s*:/i],
    ["selected background override", /--trees-selected-bg-override\s*:/i],
    ["file icon override", /--trees-file-icon-color\s*:/i],
    ["default file icon override", /--trees-file-icon-color-default\s*:/i],
  ];
  for (const [name, pattern] of required) {
    if (!pattern.test(block)) errors.push(`File-tree icon skin is missing ${name}.`);
  }

  const allowedDeclarations = new Set([
    "--trees-fg-override",
    "--trees-fg-muted-override",
    "--trees-accent-override",
    "--trees-selected-fg-override",
    "--trees-selected-bg-override",
    "--trees-file-icon-color",
    "--trees-file-icon-color-default",
  ]);
  const declarations = [...block.matchAll(/(?:^|[;{])\s*([\w-]+)\s*:/gm)].map((match) => match[1]);
  const unsafeDeclarations = declarations.filter((property) => !allowedDeclarations.has(property));
  if (unsafeDeclarations.length) {
    errors.push(`File-tree icon skin must only set approved --trees-* variables; found ${[...new Set(unsafeDeclarations)].join(", ")}.`);
  }
  if (/\bsvg\b|::(?:before|after)\b|\b(?:fill|stroke|mask|filter)\s*:/i.test(block)) {
    errors.push("File-tree icon skin must not reach into SVGs or apply visual glyph overrides.");
  }
  return { errors, present: true };
}

function inspectSidebarThemeTokens(css) {
  const required = [
    ["native icon foreground token", /--color-token-icon-foreground\s*:\s*var\(--personal-sidebar-icon-rest\)\s*!important/i],
    ["native active icon token", /--color-token-list-active-selection-icon-foreground\s*:\s*var\(--personal-sidebar-icon-active\)\s*!important/i],
  ];
  return { errors: required.filter(([, pattern]) => !pattern.test(css)).map(([name]) => `Sidebar theme is missing ${name}.`) };
}

function inspectImageTheme(css) {
  const hasTemplateMarker = css.includes(IMAGE_THEME_TEMPLATE_MARKER);
  const start = css.indexOf(IMAGE_THEME_START);
  const end = css.indexOf(IMAGE_THEME_END);
  const errors = [];
  if (hasTemplateMarker && start < 0 && end < 0) {
    return { errors, present: true, mode: "template" };
  }
  if (hasTemplateMarker) errors.push("Image-theme CSS must contain either the template marker or a rendered theme block, not both.");
  if (start < 0 || end < 0 || end <= start) {
    errors.push("Image-derived theme markers are missing or malformed.");
    return { errors, present: false, mode: "missing" };
  }
  const block = css.slice(start + IMAGE_THEME_START.length, end);
  const required = [
    ["derived flag", /--personal-image-theme-derived\s*:\s*[01]\b/i],
    ["algorithm", /--personal-image-theme-algorithm\s*:\s*[\w-]+/i],
    ["signature", /--personal-image-theme-signature\s*:\s*[\w-]+/i],
    ...IMAGE_THEME_TOKENS.map((token) => [token, new RegExp(token.replace(/[-]/g, "\\-") + "\\s*:", "i")]),
  ];
  for (const [name, pattern] of required) {
    if (!pattern.test(block)) errors.push(`Image-derived theme is missing ${name}.`);
  }
  if (/__CODEX_[A-Z_]+__/.test(block)) errors.push("Image-derived theme contains an unresolved packaging token.");
  return { errors, present: true, mode: "rendered" };
}

function inspectPastelTone(css) {
  const required = [
    ["light color scheme", /color-scheme\s*:\s*light/i],
    ["pastel image scrim", /--personal-image-scrim\s*:/i],
    ["image-derived opacity", /\.codex-personal-background[^{]*\{[^}]*opacity\s*:\s*var\(--personal-image-opacity\)/is],
    ["translucent main surface", /:is\(main,\s*\[role=["']main["']\]\)[^{]*\{[^}]*background-color\s*:\s*var\(--personal-main-surface\)/is],
    ["image-derived input surface", /--color-token-input-background\s*:\s*var\(--personal-input-surface\)\s*!important/i],
    ["opaque reading surface", /--personal-reading-surface\s*:/i],
    ["conversation body ink", /--color-token-conversation-body\s*:\s*var\(--personal-text\)\s*!important/i],
    ["conversation header ink", /--color-token-conversation-header\s*:\s*var\(--personal-text\)\s*!important/i],
    ["disabled readable surface", /--personal-disabled-surface\s*:/i],
    ["active-list foreground", /--color-token-list-active-selection-foreground\s*:\s*var\(--personal-on-active-surface\)\s*!important/i],
    ["dark primary accent", /--color-background-accent\s*:\s*var\(--personal-teal\)\s*!important/i],
    ["dark primary hover", /--color-background-button-primary-hover\s*:\s*var\(--personal-teal-hover\)\s*!important/i],
    ["terminal native background", /--vscode-terminal-background\s*:\s*var\(--personal-terminal-surface\)\s*!important/i],
    ["conversation reading anchors", /\[data-local-conversation-user-anchor\][\s\S]*?background-color\s*:\s*var\(--personal-reading-surface\)\s*!important/is],
    ["assistant reading anchor", /\[data-local-conversation-final-assistant\][\s\S]*?background-color\s*:\s*var\(--personal-reading-surface\)\s*!important/is],
    ["composer reading anchor", /\[data-codex-composer-root\]\s+\.composer-surface-chrome[\s\S]*?background-color\s*:\s*var\(--personal-reading-surface\)\s*!important/is],
    ["adaptive right panel", /aside\[data-app-shell-focus-area\s*=\s*["']right-panel["']\][\s\S]*?--color-token-bg-primary\s*:\s*var\(--personal-panel-surface\)\s*!important/is],
    ["adaptive bottom panel", /\[data-app-shell-focus-area\s*=\s*["']bottom-panel["']\][\s\S]*?--color-token-bg-primary\s*:\s*var\(--personal-panel-surface\)\s*!important/is],
    ["terminal host anchor", /\[data-codex-terminal\]\[data-codex-xterm\][\s\S]*?--vscode-terminal-foreground\s*:\s*var\(--personal-terminal-foreground\)\s*!important/is],
  ];
  const errors = required.filter(([, pattern]) => !pattern.test(css)).map(([name]) => `Pastel tone is missing ${name}.`);
  if (/color-scheme\s*:\s*dark/i.test(css)) errors.push("Pastel tone must not force a dark color scheme.");
  if (/rgba?\(\s*0\s*,\s*0\s*,\s*0/i.test(css)) errors.push("Pastel tone must not use black visual shadows or scrims.");
  return { errors };
}

export async function inspectPassiveSkin(directory, { backgroundPath } = {}) {
  const files = Object.fromEntries(await Promise.all(REQUIRED_FILES.map(async (file) => {
    const filePath = path.join(directory, file);
    return [file, await readFile(filePath, "utf8")];
  })));
  const sidebarIconSkin = inspectSidebarIconSkin(files["codex-personal.css"]);
  const fileTreeIconSkin = inspectFileTreeIconSkin(files["codex-personal.css"]);
  const sidebarThemeTokens = inspectSidebarThemeTokens(files["codex-personal.css"]);
  const imageTheme = inspectImageTheme(files["codex-personal.css"]);
  const pastelTone = inspectPastelTone(files["codex-personal.css"]);
  const derivedTheme = deriveBackgroundTheme(backgroundPath);
  const readability = assessThemeReadability(derivedTheme.tokens);
  const errors = [
    ...matches(files["codex-personal.js"], FORBIDDEN_JAVASCRIPT).map((name) => `Forbidden JavaScript: ${name}`),
    ...matches(files["codex-personal.css"], FORBIDDEN_CSS).map((name) => `Forbidden CSS: ${name}`),
    ...sidebarIconSkin.errors,
    ...fileTreeIconSkin.errors,
    ...sidebarThemeTokens.errors,
    ...imageTheme.errors,
    ...pastelTone.errors,
    ...readability.failures.map((failure) => `Theme readability failed: ${failure.name}${failure.ratio ? ` (${failure.ratio}:1 < ${failure.minimum}:1)` : ""}`),
  ];
  if (!files["codex-personal.js"].includes("__CODEX_BACKGROUND_ASSET__") && !/const BACKGROUND_ASSET = ["'](?:\.\/codex-background\.|)[^"']*["']/.test(files["codex-personal.js"])) {
    errors.push("Background asset token or injected asset path is missing.");
  }
  if (!/\[data-codex-personal-workbench\][^{]*\{[^}]*pointer-events\s*:\s*none/is.test(files["codex-personal.css"])) {
    errors.push("The workbench layer is not explicitly pointer-events:none.");
  }
  if (!/layer\.setAttribute\(\s*["']aria-hidden["']\s*,\s*["']true["']\s*\)/.test(files["codex-personal.js"])) {
    errors.push("The workbench layer is not explicitly aria-hidden.");
  }
  if (!/passiveSafety/.test(files["codex-personal.js"])) {
    errors.push("Renderer-side passive safety evidence is missing.");
  }
  return {
    status: errors.length === 0 ? "passed" : "failed",
    directory: path.resolve(directory),
    errors,
    checks: {
      files: REQUIRED_FILES,
      noInteractiveJavaScript: matches(files["codex-personal.js"], FORBIDDEN_JAVASCRIPT).length === 0,
      noUnsafeThemeCss: matches(files["codex-personal.css"], FORBIDDEN_CSS).length === 0,
      sidebarIconSkin: sidebarIconSkin.present && sidebarIconSkin.errors.length === 0,
      fileTreeIconSkin: fileTreeIconSkin.present && fileTreeIconSkin.errors.length === 0,
      sidebarThemeTokens: sidebarThemeTokens.errors.length === 0,
      imageTheme: imageTheme.present && imageTheme.errors.length === 0,
      pastelTone: pastelTone.errors.length === 0,
      readability: readability.status === "passed",
    },
    readability,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "--assets" || !args[1] || (args.length !== 2 && (args.length !== 4 || args[2] !== "--background" || !args[3]))) {
    throw new Error("Usage: node codex-passive-skin-check.mjs --assets <layout-assets-directory> [--background <image-path>]");
  }
  const result = await inspectPassiveSkin(args[1], { backgroundPath: args[3] });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
