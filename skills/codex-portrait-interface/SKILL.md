---
name: codex-portrait-interface
description: Personalize the actual Codex desktop app with supported light/dark chrome themes or a version-locked user-scoped application copy that can apply a supplied background image, automatically derive a matching palette for native sidebar icons and the composer, and safely skin navigation, workspaces, settings, dialogs, code, and diff surfaces. Use when a user asks to restyle, skin, recolor, add a background visual treatment, derive a theme from an image, or personalize the real Codex desktop interface and wants an applied, persistent, reversible result rather than a generated mockup or screenshot.
---

# Codex Portrait Interface

Personalize the real Codex desktop application. Never substitute an image mockup.

## Choose The Mode

- Use **theme mode** for colors, fonts, contrast, code themes, semantic colors, and sidebar translucency. Read [codex-theme-schema.md](references/codex-theme-schema.md) first.
- Use **layout-copy mode** when the user explicitly wants a persistent supplied image or a structural visual treatment that theme tokens cannot provide. Read [codex-layout-copy.md](references/codex-layout-copy.md) first.
- State which mode is in use. Never describe theme mode as an image insertion.
- When a reference is predominantly high-key, derive a genuinely light canvas, panel, text, and scrim system from it. Do not retain an old dark palette or place neon accents over a near-black base merely because the supplied background image is dark.
- Before layout-copy work, run `node scripts/codex-layout-copy.mjs doctor --json`. Layout-copy is experimental and supported only on Windows 10/11 with a Microsoft Store `OpenAI.Codex` version listed by the doctor check. Never bypass an unknown version unless the user explicitly accepts the experimental risk.

## Theme Mode

1. Inspect the installed version and current status with:

       node scripts/codex-theme.mjs status --json

2. If the user supplied an image, inspect it with view_image and derive palette and typography cues only. Do not call image_gen.
3. Create a task-local theme JSON that follows the reference schema. Keep text/background contrast readable and give diff-added, diff-removed, and skill accents distinct semantic colors.
4. Apply the theme with:

       node scripts/codex-theme.mjs apply --theme <absolute-theme-json> --json

5. Tell the user a Codex restart is required. Do not terminate or automate the active Codex task.
6. After restart, run status again. Treat matching effective settings as configuration proof, not proof of a visible layout change.

Theme rollback is guarded: it refuses to replace `config.toml` if the user changed it after apply. Explain the conflict and use `--force` only when the user explicitly approves replacing later configuration changes.

## Layout-Copy Mode

1. Explain that the mode creates a separate version-locked user-scoped copy and leaves the Microsoft Store installation intact.
2. Inspect a user-supplied background with view_image. Use it only when the user explicitly asks for it to appear in the application.
3. Ensure the skill-local dependencies are installed before packaging:

       npm ci
       python -m pip install -r requirements.txt

4. Derive the image palette and install or rebuild the copy:

       node scripts/codex-layout-copy.mjs install --background <absolute-image-path> --json

   --portrait remains a backward-compatible alias but new work must use --background.
   The install process deterministically samples the supplied image and packages a matching light/dark, blush/gold/cool palette for native sidebar icons, the file tree, composer/input tokens, reading surfaces, and terminal. Keep the image visibly expressed in the centre workspace; adapt sidebars, inspectors, and bottom panels with continuous image-derived surfaces instead of exposing a full-window wallpaper or mixing an unrelated palette.

5. Verify archive consistency, Store integrity, the packaged image-theme fingerprint, passive-skin regression checks, themed native sidebar icons, and renderer-side E2E evidence:

       node scripts/codex-layout-copy.mjs verify --json

6. Require status "verified", matching customized and Store archive hashes, a loaded background, a passive image layer, a passed readability and sidebar-icon theme check, and no failed native hit tests. Require body, secondary, input, disabled, code, terminal, button, and active-state contrast checks to pass before installation. Record any not-exercised route or overlay coverage rather than treating it as a pass.
7. Ask the user to close Store Codex and open **Codex Personal** from the Start menu for their persistent daily entrypoint. Reopening the ordinary Store shortcut shows the ordinary interface.
8. If the active task cannot be closed, launch an isolated side-by-side preview:

       node scripts/codex-layout-copy.mjs preview --json

9. Do not use Windows UI automation or screenshots against Codex. Renderer-side E2E, hashes, archive inspection, and runtime logs are automated evidence; the user's visual confirmation is still required for aesthetic matching. Verification closes and removes its isolated preview by default; use `--keep-preview` only when explicitly asked.

### Passive-Skin Invariant

For a persistent image skin, use layout-copy mode with --background.

- Keep the injected image decorative only: place it behind native content, mark it aria-hidden, and make it unable to receive pointer, keyboard, or focus events.
- Never inject task cards, buttons, links, or other focusable controls.
- Never call .click(), .focus(), document.execCommand(), dispatchEvent(), or write to a native editor.
- Never move, hide, resize, restack, or set overflow on html, body, #root, or native application nodes.
- Skin the left navigation, main workspace, right inspector, composer, dialogs, menus, code, terminal, and diff surfaces through visual CSS tokens/selectors only. For a supplied background, derive these tokens at installation time from the image; do not inspect user content or adapt the theme from conversation text. Keep all text-bearing conversation, input, disabled, code, dialog, and terminal surfaces opaque enough for the validated contrast contract; reserve translucent treatment for image-bearing empty workspace areas.
- For left-sidebar project, conversation, navigation, and file-tree icons, preserve the native SVGs and owners; use only scoped `color` states. Target both `aside.app-shell-left-panel` and `aside[data-testid="app-shell-floating-left-panel"]`; use `[data-sidebar-project-drop-zone="project-icon"][data-sidebar-project-kind]` for projects and `[role="button"]:has([data-thread-title])` for conversations. Use `aria-current="page"` and `aria-disabled="true"` for selected and disabled states. For `file-tree-container`, set only inherited `--trees-*` foreground/accent variables on the host; never reach into its shadow-root SVGs. A reference-derived semantic palette may distinguish normal navigation, projects/folders, conversations, files, hover, active, and disabled states. Do not replace glyphs or set `fill`, `stroke`, masks, filters, pseudo-elements, or layout properties.
- If a native surface cannot be identified safely, leave it native rather than guessing.

## Rollback

Theme mode restores the exact pre-theme config:

       node scripts/codex-theme.mjs rollback --json

Layout-copy mode removes only the personalized copy and its Start menu shortcut:

       node scripts/codex-layout-copy.mjs rollback --json

## Boundaries

- Never patch app.asar or any signed file under C:\Program Files\WindowsApps. Layout-copy mode extracts from that directory and writes only under %LOCALAPPDATA%\CodexPortrait.
- Accept only PNG, JPEG, or WebP backgrounds that pass real-format, dimension, and 24-megapixel decode limits. Re-encode them as metadata-free PNG files before packaging. Do not retain the original image path in the install manifest.
- Treat the image-theme value as a reproducibility fingerprint, not a signature or publisher authentication mechanism.
- Treat static and renderer checks as regression evidence, not a security sandbox or proof that future Codex builds cannot change behavior.
- Never use Windows UI automation against Codex.
- Do not claim that built-in theming can insert a persistent background image or restructure navigation.
- Treat a successful verify run as passive-safety evidence, not as visual approval.
- A supplied background must be copied only with explicit user intent.
- Rebuild the user-scoped copy after each Store update.
