const TEXT_CONTRAST = 4.5;
const UI_CONTRAST = 3;

export const READABILITY_TOKEN_NAMES = [
  "--personal-canvas",
  "--personal-surface-strong",
  "--personal-text",
  "--personal-muted",
  "--personal-blue",
  "--personal-teal",
  "--personal-sidebar",
  "--personal-active-surface",
  "--personal-sidebar-icon-rest",
  "--personal-sidebar-icon-project",
  "--personal-sidebar-icon-thread",
  "--personal-sidebar-icon-file",
  "--personal-sidebar-icon-active",
  "--personal-sidebar-icon-muted",
];

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function alphaValue(value) {
  const raw = String(value ?? "").trim();
  if (raw.endsWith("%")) return Math.max(0, Math.min(1, Number(raw.slice(0, -1)) / 100));
  return Math.max(0, Math.min(1, Number(raw)));
}

export function parseCssColor(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((part) => part + part).join("") : hex[1];
    return {
      red: parseInt(digits.slice(0, 2), 16),
      green: parseInt(digits.slice(2, 4), 16),
      blue: parseInt(digits.slice(4, 6), 16),
      alpha: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
    };
  }
  const functional = raw.match(/^rgba?\((.*)\)$/i);
  if (!functional) return null;
  const [channelPart, alphaPart] = functional[1].split("/");
  const commaParts = alphaPart === undefined ? functional[1].split(",").map((part) => part.trim()) : null;
  const channelSource = commaParts ? commaParts.slice(0, 3).join(" ") : channelPart;
  const channels = channelSource.replaceAll(",", " ").trim().split(/\s+/).filter(Boolean).map(Number);
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) return null;
  const commaAlpha = commaParts?.[3];
  const alpha = alphaPart ?? commaAlpha ?? "1";
  const parsedAlpha = alphaValue(alpha);
  if (!Number.isFinite(parsedAlpha)) return null;
  return { red: clamp(channels[0]), green: clamp(channels[1]), blue: clamp(channels[2]), alpha: parsedAlpha };
}

export function sourceOver(foreground, background) {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha <= 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  return {
    red: clamp((foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha),
    green: clamp((foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha),
    blue: clamp((foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha),
    alpha,
  };
}

export function flattenCssColor(value, backdrop = "#ffffff") {
  const color = parseCssColor(value);
  const under = parseCssColor(backdrop);
  if (!color || !under) return null;
  return sourceOver(color, under);
}

function relativeLuminance(color) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
}

export function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function tokenColor(tokens, reference, canvas) {
  const raw = reference.startsWith("--") ? tokens[reference] : reference;
  if (!raw) return null;
  return flattenCssColor(raw, canvas);
}

function contrastCheck(tokens, name, foreground, background, minimum, canvas) {
  const foregroundColor = tokenColor(tokens, foreground, canvas);
  const backgroundColor = tokenColor(tokens, background, canvas);
  if (!foregroundColor || !backgroundColor) {
    return { name, status: "failed", minimum, reason: "missing-or-invalid-color-token" };
  }
  const visibleForeground = sourceOver(foregroundColor, backgroundColor);
  const ratio = contrastRatio(visibleForeground, backgroundColor);
  return {
    name,
    status: ratio >= minimum ? "passed" : "failed",
    ratio: Number(ratio.toFixed(2)),
    minimum,
    foreground,
    background,
  };
}

function opaqueSurfaceCheck(tokens, name, token) {
  const color = parseCssColor(tokens[token]);
  return {
    name,
    status: color && color.alpha >= 0.999 ? "passed" : "failed",
    alpha: color ? Number(color.alpha.toFixed(2)) : null,
  };
}

export function assessThemeReadability(tokens) {
  const canvas = tokens["--personal-canvas"] ?? "#ffffff";
  const activeSurfaceLabel = tokens["--personal-on-active-surface"] ? "--personal-on-active-surface" : "#ffffff";
  const checks = [
    contrastCheck(tokens, "body-text", "--personal-text", "--personal-surface-strong", TEXT_CONTRAST, canvas),
    contrastCheck(tokens, "secondary-text", "--personal-muted", "--personal-surface-strong", TEXT_CONTRAST, canvas),
    contrastCheck(tokens, "link-text", "--personal-blue", "--personal-surface-strong", TEXT_CONTRAST, canvas),
    contrastCheck(tokens, "primary-button-label", "#ffffff", "--personal-teal", TEXT_CONTRAST, canvas),
    contrastCheck(tokens, "primary-button-hover-label", "#ffffff", "--personal-teal-hover", TEXT_CONTRAST, canvas),
    contrastCheck(tokens, "active-surface-label", activeSurfaceLabel, "--personal-active-surface", TEXT_CONTRAST, canvas),
    contrastCheck(tokens, "sidebar-navigation-icon", "--personal-sidebar-icon-rest", "--personal-sidebar", UI_CONTRAST, canvas),
    contrastCheck(tokens, "sidebar-project-icon", "--personal-sidebar-icon-project", "--personal-sidebar", UI_CONTRAST, canvas),
    contrastCheck(tokens, "sidebar-thread-icon", "--personal-sidebar-icon-thread", "--personal-sidebar", UI_CONTRAST, canvas),
    contrastCheck(tokens, "sidebar-file-icon", "--personal-sidebar-icon-file", "--personal-sidebar", UI_CONTRAST, canvas),
    contrastCheck(tokens, "sidebar-muted-icon", "--personal-sidebar-icon-muted", "--personal-sidebar", UI_CONTRAST, canvas),
    contrastCheck(tokens, "active-navigation-icon", "--personal-sidebar-icon-active", "--personal-active-surface", UI_CONTRAST, canvas),
  ];

  if (tokens["--personal-reading-surface"]) {
    checks.push(
      opaqueSurfaceCheck(tokens, "reading-surface-opaque", "--personal-reading-surface"),
      opaqueSurfaceCheck(tokens, "input-surface-opaque", "--personal-input-surface"),
      opaqueSurfaceCheck(tokens, "dialog-surface-opaque", "--personal-dialog-surface"),
      opaqueSurfaceCheck(tokens, "code-surface-opaque", "--personal-code-surface"),
      opaqueSurfaceCheck(tokens, "terminal-surface-opaque", "--personal-terminal-surface"),
      opaqueSurfaceCheck(tokens, "disabled-surface-opaque", "--personal-disabled-surface"),
      contrastCheck(tokens, "reading-surface-text", "--personal-text", "--personal-reading-surface", TEXT_CONTRAST, canvas),
      contrastCheck(tokens, "reading-surface-secondary", "--personal-muted", "--personal-reading-surface", TEXT_CONTRAST, canvas),
      contrastCheck(tokens, "input-placeholder", "--personal-muted", "--personal-input-surface", TEXT_CONTRAST, canvas),
      contrastCheck(tokens, "disabled-control-text", "--personal-disabled-text", "--personal-disabled-surface", TEXT_CONTRAST, canvas),
      contrastCheck(tokens, "code-text", "--personal-text", "--personal-code-surface", TEXT_CONTRAST, canvas),
      contrastCheck(tokens, "terminal-text", "--personal-terminal-foreground", "--personal-terminal-surface", TEXT_CONTRAST, canvas),
      contrastCheck(tokens, "active-surface-text", "--personal-on-active-surface", "--personal-active-surface", TEXT_CONTRAST, canvas),
      contrastCheck(tokens, "focus-indicator", "--personal-focus-ring", "--personal-input-surface", UI_CONTRAST, canvas),
    );
  }

  const failures = checks.filter((check) => check.status === "failed");
  return { status: failures.length ? "failed" : "passed", checks, failures };
}
