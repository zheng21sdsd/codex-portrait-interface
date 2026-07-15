# Safety model

## Design goal

Provide a local visual treatment without turning a skin into a UI automation layer or modifying the signed Store installation.

## Theme mode

Theme mode uses Codex's configuration interface to apply appearance values. It backs up the local configuration before applying and records a post-apply hash. Rollback stops if the configuration changed afterward, unless the user explicitly chooses `--force`.

## Layout-copy mode

Layout-copy is intentionally narrower than a general patcher:

- It runs only on Windows and copies the current Microsoft Store `OpenAI.Codex` app into `%LOCALAPPDATA%\CodexPortrait`.
- It never writes to `C:\Program Files\WindowsApps`.
- It fails closed for Store versions outside the tested compatibility list unless the user deliberately requests an experimental override.
- It runs a local, lockfile-pinned archive tool rather than downloading one at runtime.
- It derives the executable location from the guarded local copy; `manifest.json` is state metadata, not authority to launch an arbitrary executable.
- It only deletes a Start Menu shortcut whose target, working directory, and install identifier prove that this project created it.

## Passive skin invariant

The injected JavaScript creates one decorative visual layer. It must be `aria-hidden`, unable to receive pointer or keyboard input, unfocusable, and behind native content. The project must not:

- automate clicks, focus, typing, or commands;
- create custom buttons, links, inputs, or task cards;
- read or retain conversation text;
- change native root layout, scroll behavior, or hit targets; or
- replace native sidebar SVGs.

The CSS may set scoped colour tokens for native icons and file-tree hosts, but does not replace glyphs or set SVG `fill`, `stroke`, masks, or filters.

## Verification limits

Static checks and isolated renderer evidence catch regressions in this repository's injected code. They are not a security sandbox, do not validate every future Codex build, and do not replace a user's visual review. The repository does not use Windows UI automation or screenshot automation against Codex.
