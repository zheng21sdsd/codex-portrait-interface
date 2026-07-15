# Codex Layout-Copy Mode

## Purpose

Use this mode when theme tokens are insufficient and the user explicitly wants a persistent supplied image in the real Codex desktop application. It creates a separate user-scoped runtime copy and never edits the signed Microsoft Store package.

## Installed Artifacts

- Application copy: %LOCALAPPDATA%\CodexPortrait\<store-version>\app
- Manifest: %LOCALAPPDATA%\CodexPortrait\manifest.json
- Start menu shortcut: %APPDATA%\Microsoft\Windows\Start Menu\Programs\Codex Personal.lnk
- Original copied archive backup: resources\app.asar.store-original inside the versioned copy

The customization is a passive, image-derived visual skin. It samples a supplied image during installation and packages a deterministic palette for native navigation, workspace, right inspector, composer, settings, dialogs, menus, code, terminal, and diff surfaces. Left-sidebar project, conversation, file-tree, and related navigation icons retain their native SVGs and receive scoped semantic theme colors. The supplied image is an aria-hidden, pointer-inert background beneath native content.

## Image-Derived Theme Profile

For every `--background` installation, `derive-background-theme.py` validates the actual image format and dimensions, samples it with Pillow, removes metadata, and re-encodes it as a packaged PNG. `codex-background-theme.mjs` validates the resulting CSS token block and records a reproducibility fingerprint. That fingerprint is not a publisher signature or an authentication mechanism. The image remains below native content, but it must be visibly recognizable through the centre workspace. Fade it toward opaque, image-derived sidebar, inspector, and bottom-panel surfaces so the UI reads as one continuous composition rather than a full-window wallpaper with disconnected panels. Do not make a loaded image disappear through stacked opaque centre surfaces, and do not elevate it above native UI.

The derived palette provides readable ink, blush, gold, cool, and light swatches. It drives regular, project/folder, conversation, file, hover, active, and disabled native icon colors as well as composer/input backgrounds, borders, focus rings, reading surfaces, terminal colors, and shadows. Text-bearing conversation, disabled-control, input, menu, dialog, code, and terminal surfaces use opaque generated values; only the empty main workspace remains translucent. The runtime verifier requires a loaded background, a derived theme marker, valid generated colors, validated contrast, and an image opacity from 0.28 through 0.65 when a background is present.

## Commands

    node scripts/codex-layout-copy.mjs install --background C:\absolute\background.png --json
    node scripts/codex-layout-copy.mjs install --background C:\absolute\background.png --dry-run --json
    node scripts/codex-layout-copy.mjs doctor --json
    node scripts/codex-background-theme.mjs --background C:\absolute\background.png --json
    node scripts/codex-layout-copy.mjs status --json
    node scripts/codex-layout-copy.mjs verify --json
    node scripts/codex-layout-copy.mjs launch --json
    node scripts/codex-layout-copy.mjs preview --json
    node scripts/codex-layout-copy.mjs rollback --json

--portrait is retained only as a compatibility alias for --background.

Install validates an optional PNG/JPEG/WebP background up to 50 MB and 24 megapixels, derives and validates its palette, copies the runtime, extracts the original archive, injects the passive assets plus the fingerprinted token block, repacks it, hashes the result, writes a path-redacted manifest, and creates a tool-owned Start menu shortcut. It uses the package-lock-pinned `@electron/asar` dependency installed by `npm ci`; it does not download or execute an `npx` package at install time. If no image is given, it uses a decorative CSS fallback.

## Passive-Skin Constraints

- Create one aria-hidden custom background layer only.
- Keep the layer and every descendant pointer-inert and behind native content.
- Do not create custom buttons, links, cards, inputs, or focusable controls.
- Do not click native controls, write to the composer, synthesize events, or inspect/retain user text.
- Do not set layout, scrolling, sizing, stacking, or pointer-event properties on html, body, #root, or native nodes.
- Do not use a fixed foreground image, a signature badge, a hero page, or route-specific overlay hiding.
- Style left navigation, main workspace, and right panel through visual properties only. Missing or ambiguous targets must remain native.
- Scope left-icon treatment to both `aside.app-shell-left-panel` and `aside[data-testid="app-shell-floating-left-panel"]`. Use `[data-sidebar-project-drop-zone="project-icon"][data-sidebar-project-kind]` for a project/folder icon and `[role="button"]:has([data-thread-title])` for a conversation icon; selected/disabled native rows use `aria-current="page"` and `aria-disabled="true"`. Set only `color` on native SVGs; do not replace glyphs, add icon assets, alter `fill` or `stroke`, or modify the native control/DOM structure. For the open-shadow-root `file-tree-container`, set only inherited `--trees-*` foreground/accent variables on the host and do not target its SVGs.

## Verification

Run verify after installation. It requires all of the following:

1. The personalized archive hash matches the manifest.
2. The current Store archive hash still matches the manifest source hash.
3. The Store version has not changed since installation.
4. Source and installed archive assets pass the static passive-safety and image-theme scan.
5. The packaged entrypoint contains only the passive stylesheet and script.
6. The packaged background file and image-theme fingerprint, when present, match the manifest.
7. An isolated renderer preview emits its passive-safety E2E evidence.

The renderer E2E checks background loading, generated palette markers, text/button/icon/focus contrast, opaque reading surfaces, image opacity, aria-hidden and pointer-inert custom nodes, no focus change, a full native root, background stacking below root, themed sidebar SVG paint values, absence of custom-layer obstruction at each icon, and observed native-owner hit coverage. It checks mounted conversation, composer, right-panel, bottom-panel, and terminal surface colors without reading user content. It requires the regular sidebar variant to pass, reports the floating variant as passed, failed, or not-exercised, and checks mounted file-tree hosts through their `--trees-*` variables. Dialog, menu, and listbox coverage is reported as passed, failed, or not-exercised because automation must not drive Codex into every state.

The automation policy forbids capturing or controlling Codex itself. Use hashes, archive inspection, renderer evidence, and runtime logs as regression evidence, not as a sandbox or proof of future-build safety. Require the user's visual confirmation for reference matching. Verification destroys its isolated profile and runtime log by default; `--keep-preview` is an explicit diagnostic opt-in.

## Updates And Rollback

If status reports updateAvailable true, rebuild with install and the desired --background. A new Store version is rejected until it appears in the compatibility matrix, unless an explicit `--allow-unsupported-version` experimental override is supplied. Rollback refuses while the personalized executable is active, removes only a shortcut whose target, working directory, and install ID prove tool ownership, then removes the guarded `%LOCALAPPDATA%\CodexPortrait` copy. If an existing shortcut cannot be proven to belong to this tool, it is preserved.
