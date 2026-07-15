const INTERFACE_VERSION = "codex-personal-readable-continuous-2026.07.15.9";
const BACKGROUND_ASSET = "__CODEX_BACKGROUND_ASSET__";
const E2E_MARKER = "[codex-personal-e2e]";
const MAX_RENDERER_READY_ATTEMPTS = 42;
const SIDEBAR_VARIANTS = [
  { name: "regular", selector: "aside.app-shell-left-panel" },
  { name: "floating", selector: 'aside[data-testid="app-shell-floating-left-panel"]' },
];
const SIDEBAR_SELECTOR = SIDEBAR_VARIANTS.map(({ selector }) => selector).join(", ");
const SIDEBAR_ICON_OWNER_SELECTOR = ':is(button, [role="button"], a, [role="link"], [role="tab"], [role="treeitem"], [role="listitem"])';
const SIDEBAR_ICON_SELECTOR = [
  `${SIDEBAR_ICON_OWNER_SELECTOR} svg`,
  '[data-sidebar-project-drop-zone="project-icon"][data-sidebar-project-kind] svg',
].join(", ");
const SIDEBAR_PROJECT_ITEM_SELECTOR = '[data-sidebar-project-drop-zone="project-icon"][data-sidebar-project-kind]';
const SIDEBAR_THREAD_ITEM_SELECTOR = '[role="button"]:has([data-thread-title])';
const FILE_TREE_HOST_SELECTOR = "file-tree-container";
const ACTIVE_SIDEBAR_ITEM_SELECTOR = [
  '[aria-current="page"]',
  '[aria-current="true"]',
  '[aria-selected="true"]',
  '[data-state="active"]',
  '[data-state="selected"]',
  '[data-active="true"]',
  '[data-selected="true"]',
].join(", ");
const DISABLED_SIDEBAR_ITEM_SELECTOR = ':is(:disabled, [aria-disabled="true"])';
const NATIVE_SURFACE_EXPECTATIONS = [
  { name: "conversation", selector: "[data-local-conversation-user-anchor], [data-local-conversation-final-assistant]", token: "--personal-reading-surface" },
  { name: "composer", selector: "[data-codex-composer-root] .composer-surface-chrome", token: "--personal-reading-surface" },
  { name: "right-overlay", selector: '[data-testid="right-panel-composer-overlay"] [data-right-panel-composer-overlay-content="true"]', token: "--personal-reading-surface" },
  { name: "right-panel", selector: 'aside[data-app-shell-focus-area="right-panel"]', token: "--personal-panel-surface" },
  { name: "bottom-panel", selector: '[data-app-shell-focus-area="bottom-panel"]', token: "--personal-panel-surface" },
  { name: "terminal", selector: "[data-codex-terminal][data-codex-xterm]", token: "--personal-terminal-surface" },
];
const IMAGE_THEME_COLOR_TOKENS = [
  "--personal-canvas",
  "--personal-sidebar",
  "--personal-input-surface",
  "--personal-reading-surface",
  "--personal-disabled-surface",
  "--personal-disabled-text",
  "--personal-on-active-surface",
  "--personal-terminal-surface",
  "--personal-terminal-foreground",
  "--personal-focus-ring",
  "--personal-sidebar-icon-rest",
  "--personal-sidebar-icon-project",
  "--personal-sidebar-icon-thread",
  "--personal-sidebar-icon-file",
  "--personal-sidebar-icon-hover",
  "--personal-sidebar-icon-active",
  "--personal-sidebar-icon-muted",
];

function isVisible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return bounds.width > 4 && bounds.height > 4 && style.display !== "none" && style.visibility !== "hidden";
}

function isCustomNode(node, layer) {
  return node instanceof Node && (node === layer || layer.contains(node));
}

function candidateFor(selector, score) {
  const candidates = Array.from(document.querySelectorAll(selector))
    .filter((element) => isVisible(element))
    .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
    .map((candidate) => ({ ...candidate, score: score(candidate.bounds) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.element ?? null;
}

function findSidebar() {
  const viewportArea = innerWidth * innerHeight;
  return candidateFor(SIDEBAR_SELECTOR, (bounds) =>
    bounds.left < innerWidth * 0.45 ? viewportArea + bounds.width * bounds.height : -Infinity);
}

function colorKey(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((part) => part + part).join("") : hex[1];
    return `rgb(${parseInt(digits.slice(0, 2), 16)},${parseInt(digits.slice(2, 4), 16)},${parseInt(digits.slice(4, 6), 16)})`;
  }
  const rgb = raw.match(/^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)/);
  return rgb ? `rgb(${Number(rgb[1])},${Number(rgb[2])},${Number(rgb[3])})` : "";
}

function paintIsOpaque(value, opacity) {
  if (value === "none" || Number(opacity) <= 0) return false;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw.startsWith("rgba(")) return true;
  const components = raw.slice(5, -1).split(",").map((component) => component.trim());
  return components.length < 4 || Number(components[3]) > 0;
}

function isVisibleSvg(svg) {
  const bounds = svg.getBoundingClientRect();
  const style = getComputedStyle(svg);
  return bounds.width > 4 && bounds.height > 4 && style.display !== "none" && style.visibility !== "hidden";
}

function svgPaintMatches(svg, expectedColor) {
  const shapes = [...svg.querySelectorAll("path,circle,ellipse,line,polyline,polygon,rect,use")]
    .filter((node) => !node.closest("defs,clipPath,mask,pattern,symbol"));
  const svgColorMatches = colorKey(getComputedStyle(svg).color) === expectedColor;
  let observedPaints = 0;
  let mismatchedPaints = 0;
  for (const shape of shapes) {
    const style = getComputedStyle(shape);
    const paints = [
      paintIsOpaque(style.fill, style.fillOpacity) ? colorKey(style.fill) : "",
      paintIsOpaque(style.stroke, style.strokeOpacity) ? colorKey(style.stroke) : "",
    ].filter(Boolean);
    observedPaints += paints.length;
    mismatchedPaints += paints.filter((paint) => paint !== expectedColor).length;
  }
  return {
    inspectable: observedPaints > 0,
    matches: svgColorMatches && (observedPaints === 0 || mismatchedPaints === 0),
  };
}

function collectIconHitEvidence(svg, layer, sidebar) {
  const bounds = svg.getBoundingClientRect();
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
    return { customLayerInHitStack: false, nativeOwnerHit: false, sidebarSurfaceHit: false, svgPointerEvents: getComputedStyle(svg).pointerEvents, withinViewport: false };
  }
  const owner = svg.closest(SIDEBAR_ICON_OWNER_SELECTOR) ?? svg.closest(SIDEBAR_PROJECT_ITEM_SELECTOR) ?? svg;
  const stack = document.elementsFromPoint(x, y);
  return {
    customLayerInHitStack: stack.some((node) => isCustomNode(node, layer)),
    nativeOwnerHit: stack.some((node) => node instanceof Node && (node === owner || owner.contains(node))),
    sidebarSurfaceHit: stack.some((node) => node instanceof Node && (node === sidebar || sidebar.contains(node))),
    svgPointerEvents: getComputedStyle(svg).pointerEvents,
    withinViewport: true,
  };
}

function iconPaletteState(svg, palette) {
  if (svg.closest(DISABLED_SIDEBAR_ITEM_SELECTOR)) return { color: palette.muted, state: "muted" };
  if (svg.closest(ACTIVE_SIDEBAR_ITEM_SELECTOR)) return { color: palette.active, state: "active" };
  const owner = svg.closest(SIDEBAR_ICON_OWNER_SELECTOR);
  const project = svg.closest(SIDEBAR_PROJECT_ITEM_SELECTOR);
  if (owner?.matches(":hover") || project?.matches(":hover")) return { color: palette.hover, state: "hover" };
  if (svg.closest(SIDEBAR_THREAD_ITEM_SELECTOR)) return { color: palette.thread, state: "thread" };
  if (project) return { color: palette.project, state: "project" };
  return { color: palette.rest, state: "rest" };
}

function readSidebarPalette(rootStyle) {
  return {
    rest: colorKey(rootStyle.getPropertyValue("--personal-sidebar-icon-rest")),
    project: colorKey(rootStyle.getPropertyValue("--personal-sidebar-icon-project")),
    thread: colorKey(rootStyle.getPropertyValue("--personal-sidebar-icon-thread")),
    file: colorKey(rootStyle.getPropertyValue("--personal-sidebar-icon-file")),
    hover: colorKey(rootStyle.getPropertyValue("--personal-sidebar-icon-hover")),
    active: colorKey(rootStyle.getPropertyValue("--personal-sidebar-icon-active")),
    muted: colorKey(rootStyle.getPropertyValue("--personal-sidebar-icon-muted")),
  };
}

function collectImageTheme(rootStyle, backgroundRequested, image) {
  const derived = rootStyle.getPropertyValue("--personal-image-theme-derived").trim();
  const algorithm = rootStyle.getPropertyValue("--personal-image-theme-algorithm").trim();
  const signature = rootStyle.getPropertyValue("--personal-image-theme-signature").trim();
  const missingTokens = IMAGE_THEME_COLOR_TOKENS.filter((token) => !colorKey(rootStyle.getPropertyValue(token)));
  const requestedOpacity = Number(rootStyle.getPropertyValue("--personal-image-opacity").trim());
  const renderedOpacity = image ? Number(getComputedStyle(image).opacity) : 0;
  const failures = [
    ...(backgroundRequested && derived !== "1" ? ["background-theme-not-derived"] : []),
    ...(!algorithm ? ["background-theme-algorithm-missing"] : []),
    ...(!signature ? ["background-theme-signature-missing"] : []),
    ...(missingTokens.length ? ["background-theme-color-token-missing"] : []),
    ...(backgroundRequested && (!Number.isFinite(requestedOpacity) || requestedOpacity < 0.28 || requestedOpacity > 0.65) ? ["background-theme-opacity-out-of-range"] : []),
    ...(backgroundRequested && (!Number.isFinite(renderedOpacity) || renderedOpacity < 0.28 || renderedOpacity > 0.65) ? ["background-rendered-opacity-out-of-range"] : []),
  ];
  return {
    status: failures.length ? "failed" : "passed",
    derived: derived === "1",
    algorithm,
    signature,
    requestedOpacity,
    renderedOpacity,
    missingTokens,
    failures,
  };
}

function contrastColor(value) {
  const key = colorKey(value);
  const match = key.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
  return match ? { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]) } : null;
}

function relativeLuminance(color) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
}

function rootContrast(rootStyle, foreground, background) {
  const read = (reference) => contrastColor(reference.startsWith("--") ? rootStyle.getPropertyValue(reference) : reference);
  const foregroundColor = read(foreground);
  const backgroundColor = read(background);
  if (!foregroundColor || !backgroundColor) return null;
  const ratio = (Math.max(relativeLuminance(foregroundColor), relativeLuminance(backgroundColor)) + 0.05)
    / (Math.min(relativeLuminance(foregroundColor), relativeLuminance(backgroundColor)) + 0.05);
  return Number(ratio.toFixed(2));
}

function collectReadability(rootStyle) {
  const pairs = [
    ["body-text", "--personal-text", "--personal-reading-surface", 4.5],
    ["secondary-text", "--personal-muted", "--personal-reading-surface", 4.5],
    ["input-placeholder", "--personal-muted", "--personal-input-surface", 4.5],
    ["link-text", "--personal-blue", "--personal-reading-surface", 4.5],
    ["primary-button-label", "#ffffff", "--personal-teal", 4.5],
    ["primary-button-hover-label", "#ffffff", "--personal-teal-hover", 4.5],
    ["active-surface-label", "--personal-on-active-surface", "--personal-active-surface", 4.5],
    ["disabled-control-text", "--personal-disabled-text", "--personal-disabled-surface", 4.5],
    ["code-text", "--personal-text", "--personal-code-surface", 4.5],
    ["terminal-text", "--personal-terminal-foreground", "--personal-terminal-surface", 4.5],
    ["focus-indicator", "--personal-focus-ring", "--personal-input-surface", 3],
    ["sidebar-navigation-icon", "--personal-sidebar-icon-rest", "--personal-sidebar", 3],
    ["sidebar-muted-icon", "--personal-sidebar-icon-muted", "--personal-sidebar", 3],
    ["active-navigation-icon", "--personal-sidebar-icon-active", "--personal-active-surface", 3],
  ];
  const checks = pairs.map(([name, foreground, background, minimum]) => {
    const ratio = rootContrast(rootStyle, foreground, background);
    return { name, status: ratio !== null && ratio >= minimum ? "passed" : "failed", ratio, minimum };
  });
  const opaqueTokens = [
    "--personal-reading-surface",
    "--personal-input-surface",
    "--personal-dialog-surface",
    "--personal-code-surface",
    "--personal-disabled-surface",
    "--personal-terminal-surface",
  ];
  for (const token of opaqueTokens) {
    const value = rootStyle.getPropertyValue(token).trim();
    const alpha = value.match(/\/\s*([\d.]+)%?\s*\)/)?.[1] ?? value.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/i)?.[1] ?? "1";
    const opacity = value.includes("%") ? Number(alpha) / 100 : Number(alpha);
    checks.push({ name: token + "-opaque", status: Number.isFinite(opacity) && opacity >= 0.999 ? "passed" : "failed", opacity: Number.isFinite(opacity) ? Number(opacity.toFixed(2)) : null, minimum: 1 });
  }
  const failures = checks.filter((check) => check.status === "failed");
  return { status: failures.length ? "failed" : "passed", checks, failures: failures.map((check) => check.name) };
}

function collectNativeSurfaceTheme(rootStyle) {
  const variants = Object.fromEntries(NATIVE_SURFACE_EXPECTATIONS.map(({ name, selector, token }) => {
    const expected = colorKey(rootStyle.getPropertyValue(token));
    const elements = [...document.querySelectorAll(selector)].filter(isVisible);
    if (!elements.length) return [name, { status: "not-exercised", reason: "surface-not-mounted" }];
    const mismatchedCount = elements.filter((element) => colorKey(getComputedStyle(element).backgroundColor) !== expected).length;
    return [name, { status: mismatchedCount ? "failed" : "passed", sampleCount: elements.length, mismatchedCount, expected }];
  }));
  const values = Object.values(variants);
  return {
    status: values.some((variant) => variant.status === "failed") ? "failed" : values.some((variant) => variant.status === "passed") ? "passed" : "not-exercised",
    variants,
  };
}

function resolvedCustomColor(style, property, rootStyle) {
  const value = style.getPropertyValue(property);
  const direct = colorKey(value);
  if (direct) return direct;
  const variable = value.match(/var\(\s*(--[\w-]+)/)?.[1];
  return variable ? colorKey(rootStyle.getPropertyValue(variable)) : "";
}

function collectFileTreeTheme(sidebar, layer, palette, rootStyle) {
  const hosts = [...sidebar.querySelectorAll(FILE_TREE_HOST_SELECTOR)].filter(isVisible);
  if (!hosts.length) return { status: "not-exercised", reason: "file-tree-not-mounted" };
  const expected = [
    ["--trees-fg-override", palette.file],
    ["--trees-fg-muted-override", palette.muted],
    ["--trees-accent-override", palette.active],
    ["--trees-selected-fg-override", palette.active],
    ["--trees-selected-bg-override", colorKey(rootStyle.getPropertyValue("--color-token-list-active-selection-background"))],
    ["--trees-file-icon-color", palette.file],
    ["--trees-file-icon-color-default", palette.file],
  ];
  let mismatchedHosts = 0;
  let hitFailures = 0;
  for (const host of hosts) {
    const style = getComputedStyle(host);
    if (expected.some(([property, color]) => resolvedCustomColor(style, property, rootStyle) !== color)) mismatchedHosts += 1;
    if (targetAt("file-tree", host, layer).status === "failed") hitFailures += 1;
  }
  return {
    status: mismatchedHosts || hitFailures ? "failed" : "passed",
    hostCount: hosts.length,
    mismatchedHosts,
    hitFailures,
  };
}

function collectSidebarVariant(sidebar, layer, palette, rootStyle) {
  const icons = [...sidebar.querySelectorAll(SIDEBAR_ICON_SELECTOR)].filter(isVisibleSvg);
  const fileTree = collectFileTreeTheme(sidebar, layer, palette, rootStyle);
  if (!icons.length) return { status: "not-exercised", reason: "no-visible-sidebar-icons", fileTree };

  const states = { rest: 0, project: 0, thread: 0, hover: 0, active: 0, muted: 0 };
  let themedCount = 0;
  let nativeHitCount = 0;
  let failedPaintCount = 0;
  let customLayerHitCount = 0;
  const paintMismatchStates = {};
  const nativeHitMisses = { customLayer: 0, outsideViewport: 0, pointerEventsNone: 0, sidebarSurface: 0, other: 0 };
  for (const svg of icons) {
    const expected = iconPaletteState(svg, palette);
    const paint = svgPaintMatches(svg, expected.color);
    const hit = collectIconHitEvidence(svg, layer, sidebar);
    const nativeHitSafe = !hit.customLayerInHitStack && hit.nativeOwnerHit;
    states[expected.state] += 1;
    if (paint.matches) themedCount += 1;
    else {
      failedPaintCount += 1;
      paintMismatchStates[expected.state] = (paintMismatchStates[expected.state] ?? 0) + 1;
    }
    if (nativeHitSafe) nativeHitCount += 1;
    if (!nativeHitSafe) {
      if (hit.customLayerInHitStack) nativeHitMisses.customLayer += 1;
      else if (!hit.withinViewport) nativeHitMisses.outsideViewport += 1;
      else if (hit.svgPointerEvents === "none") nativeHitMisses.pointerEventsNone += 1;
      else if (hit.sidebarSurfaceHit) nativeHitMisses.sidebarSurface += 1;
      else nativeHitMisses.other += 1;
    }
    if (hit.customLayerInHitStack) customLayerHitCount += 1;
  }
  return {
    status: failedPaintCount || customLayerHitCount || fileTree.status === "failed" ? "failed" : "passed",
    sampleCount: icons.length,
    themedCount,
    nativeHitCount,
    nativeHitMisses,
    stateSamples: states,
    paintMismatchStates,
    fileTree,
    failures: [
      ...(failedPaintCount ? ["icon-paint-outside-theme-palette"] : []),
      ...(customLayerHitCount ? ["custom-layer-in-icon-hit-stack"] : []),
      ...(fileTree.status === "failed" ? ["file-tree-theme-or-hit-check-failed"] : []),
    ],
  };
}

function collectSidebarIconTheme(layer) {
  const rootStyle = getComputedStyle(document.documentElement);
  const palette = readSidebarPalette(rootStyle);
  if (Object.values(palette).some((color) => !color)) {
    return { status: "failed", reason: "sidebar-icon-palette-invalid" };
  }
  const variants = Object.fromEntries(SIDEBAR_VARIANTS.map(({ name, selector }) => {
    const sidebar = document.querySelector(selector);
    return [name, sidebar ? collectSidebarVariant(sidebar, layer, palette, rootStyle) : { status: "not-exercised", reason: "sidebar-not-mounted" }];
  }));
  const anyFailure = Object.values(variants).some((variant) => variant.status === "failed");
  const regular = variants.regular;
  return {
    status: anyFailure ? "failed" : regular?.status === "passed" ? "passed" : "not-exercised",
    variants,
  };
}

function targetAt(name, element, layer) {
  if (!element) return { status: "not-exercised" };
  const bounds = element.getBoundingClientRect();
  const insetX = Math.min(8, Math.max(1, bounds.width / 4));
  const insetY = Math.min(8, Math.max(1, bounds.height / 4));
  const points = [
    [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
    [bounds.left + insetX, bounds.top + insetY],
    [bounds.right - insetX, bounds.bottom - insetY],
  ].filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
  const failures = [];
  for (const [x, y] of points) {
    const stack = document.elementsFromPoint(x, y);
    if (stack.some((node) => isCustomNode(node, layer))) failures.push("custom-layer-in-hit-stack");
    const nativeHit = stack.some((node) => node instanceof Node && (node === element || element.contains(node) || node.contains(element)));
    if (!nativeHit) failures.push("native-target-not-hit");
  }
  return {
    status: failures.length === 0 ? "passed" : "failed",
    sampleCount: points.length,
    failures: [...new Set(failures)],
    geometry: { width: Math.round(bounds.width), height: Math.round(bounds.height) },
  };
}

function collectTargets(layer) {
  const viewportArea = innerWidth * innerHeight;
  const sidebar = findSidebar();
  const main = candidateFor('main, [role="main"]', (bounds) => bounds.width * bounds.height);
  const composer = candidateFor('textarea, [contenteditable="true"]', (bounds) =>
    bounds.bottom > innerHeight * 0.48 && bounds.width > innerWidth * 0.25 ? bounds.width * bounds.height : -Infinity);
  const right = candidateFor(':is(aside, [role="complementary"], [data-testid*="right" i], [data-testid*="inspector" i]):not(.app-shell-left-panel)', (bounds) =>
    bounds.left > innerWidth * 0.55 ? viewportArea + bounds.width * bounds.height : -Infinity);
  const bottom = candidateFor('[data-app-shell-focus-area="bottom-panel"]', (bounds) => bounds.bottom > innerHeight * 0.55 ? bounds.width * bounds.height : -Infinity);
  const terminal = candidateFor('[data-codex-terminal][data-codex-xterm]', (bounds) => bounds.width * bounds.height);
  const generic = candidateFor('button, [role="button"], input, textarea, [contenteditable="true"]', (bounds) => bounds.width * bounds.height);
  return {
    sidebar: targetAt("sidebar", sidebar, layer),
    main: targetAt("main", main, layer),
    composer: targetAt("composer", composer, layer),
    right: targetAt("right", right, layer),
    bottom: targetAt("bottom", bottom, layer),
    terminal: targetAt("terminal", terminal, layer),
    generic: targetAt("generic", generic, layer),
  };
}

function collectOverlay(selector, layer) {
  return targetAt("overlay", candidateFor(selector, (bounds) => bounds.width * bounds.height), layer).status;
}

function collectEvidence(layer, image, installationFocusUnchanged, attempt) {
  const root = document.getElementById("root");
  const rootBounds = root?.getBoundingClientRect();
  const backgroundRequested = Boolean(BACKGROUND_ASSET);
  const backgroundLoaded = !backgroundRequested || Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
  const layerNodes = [layer, ...layer.querySelectorAll("*")];
  const targets = collectTargets(layer);
  const sidebarIconTheme = collectSidebarIconTheme(layer);
  const rootStyle = getComputedStyle(document.documentElement);
  const imageTheme = collectImageTheme(rootStyle, backgroundRequested, image);
  const readability = collectReadability(rootStyle);
  const nativeSurfaceTheme = collectNativeSurfaceTheme(rootStyle);
  const rootGeometry = Boolean(rootBounds && rootBounds.width >= innerWidth * 0.8 && rootBounds.height >= innerHeight * 0.5);
  const passiveSafety = {
    layerExists: Boolean(layer.isConnected),
    ariaHidden: layer.getAttribute("aria-hidden") === "true",
    layerPointerEventsNone: layerNodes.every((node) => getComputedStyle(node).pointerEvents === "none"),
    noFocusableDescendants: layer.querySelectorAll('a, button, input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])').length === 0,
    focusUnchanged: installationFocusUnchanged,
    customLayerBelowRoot: Boolean(root && (layer.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING) && Number(getComputedStyle(layer).zIndex) < 0),
    rootGeometry,
    imageTheme,
    readability,
    nativeSurfaceTheme,
    nativeTargets: targets,
    sidebarIconTheme,
    overlays: {
      dialog: collectOverlay('[role="dialog"]', layer),
      menu: collectOverlay('[role="menu"]', layer),
      listbox: collectOverlay('[role="listbox"]', layer),
    },
  };
  const ready = backgroundLoaded && imageTheme.status === "passed" && readability.status === "passed" && nativeSurfaceTheme.status !== "failed" && targets.generic.status !== "not-exercised" && sidebarIconTheme.status !== "not-exercised";
  return {
    interfaceVersion: INTERFACE_VERSION,
    attempt,
    settled: ready || attempt >= MAX_RENDERER_READY_ATTEMPTS,
    background: {
      requested: backgroundRequested,
      loaded: backgroundLoaded,
      width: image?.naturalWidth ?? 0,
      height: image?.naturalHeight ?? 0,
    },
    passiveSafety,
  };
}

function reportPassiveSafety(layer, image, installationFocusUnchanged, attempt = 0) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const evidence = collectEvidence(layer, image, installationFocusUnchanged, attempt);
    console.info(E2E_MARKER + " " + JSON.stringify(evidence));
    if (!evidence.settled) setTimeout(() => reportPassiveSafety(layer, image, installationFocusUnchanged, attempt + 1), 500);
  }));
}

function installPassiveSkin() {
  if (document.querySelector("[data-codex-personal-workbench]")) return;
  const initialFocus = document.activeElement;
  const layer = document.createElement("div");
  layer.dataset.codexPersonalWorkbench = INTERFACE_VERSION;
  layer.setAttribute("aria-hidden", "true");
  if (BACKGROUND_ASSET) {
    const image = document.createElement("img");
    image.className = "codex-personal-background";
    image.src = BACKGROUND_ASSET;
    image.alt = "";
    image.decoding = "async";
    layer.append(image);
  } else {
    layer.dataset.codexPersonalFallback = "true";
  }
  document.body.prepend(layer);
  const installationFocusUnchanged = document.activeElement === initialFocus;
  document.documentElement.dataset.codexPersonalInterface = INTERFACE_VERSION;

  const image = layer.querySelector(".codex-personal-background");
  if (image && !image.complete) {
    image.addEventListener("load", () => reportPassiveSafety(layer, image, installationFocusUnchanged), { once: true });
    image.addEventListener("error", () => reportPassiveSafety(layer, image, installationFocusUnchanged), { once: true });
  }
  reportPassiveSafety(layer, image, installationFocusUnchanged);
  console.info("[codex-personal-interface] installed " + INTERFACE_VERSION);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installPassiveSkin, { once: true });
} else {
  installPassiveSkin();
}
