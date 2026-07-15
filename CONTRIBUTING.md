# Contributing

Thanks for helping improve a careful, local-only customization tool.

## Scope

- Keep theme mode within supported Codex configuration APIs.
- Keep layout-copy experimental, Windows-only, user-scoped, and version-locked.
- Never patch `C:\Program Files\WindowsApps`, redistribute Codex, or add UI automation, screenshots, synthetic input, content collection, or network requests to the injected assets.
- Preserve the passive-layer invariant: injected visuals stay `aria-hidden`, pointer-inert, unfocusable, and behind native content.

## Local checks

From the repository root:

```powershell
npm ci --prefix .\skills\codex-portrait-interface
py -3 -m pip install -r .\skills\codex-portrait-interface\requirements.txt
node .\scripts\verify-release.mjs
node .\skills\codex-portrait-interface\scripts\codex-passive-skin-check.mjs --assets .\skills\codex-portrait-interface\assets\layout
py -3 .\tests\test_image_safety.py
```

Do not use live Codex UI automation as a test. Tests must not need a Codex account, a background image, a Store archive, or private machine state.

## Pull requests

1. Open an issue first for a larger behavior or compatibility change.
2. Keep changes focused and explain the user-visible and safety impact.
3. Add or update a focused test for security-sensitive parsing, image handling, rollback, or selector behavior.
4. Update `CHANGELOG.md`, compatibility notes, and user documentation when behavior changes.
5. Do not commit generated archives, `node_modules`, user images, profiles, logs, screenshots, secrets, or machine-specific paths.

By contributing, you agree that your contribution may be distributed under the MIT License.
