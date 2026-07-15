# Codex Desktop Theme Schema

## Supported Settings

The current Codex desktop theme model persists these keys under `[desktop]`:

- `appearanceTheme`: `system`, `light`, or `dark`
- `appearanceLightChromeTheme` and `appearanceDarkChromeTheme`
- `appearanceLightCodeThemeId` and `appearanceDarkCodeThemeId`
- `sansFontSize` and `codeFontSize`

A chrome theme has this JSON shape:

```json
{
  "accent": "#AA6BB5",
  "contrast": 46,
  "fonts": {
    "code": "Cascadia Code",
    "ui": "Segoe UI Variable"
  },
  "ink": "#3A2630",
  "opaqueWindows": false,
  "semanticColors": {
    "diffAdded": "#3F8A63",
    "diffRemoved": "#C65A67",
    "skill": "#AA6BB5"
  },
  "surface": "#FFF8FC"
}
```

## Validation Rules

- Use six-digit hex colors.
- Keep `contrast` an integer from 0 through 100.
- Use installed font-family names or `null`.
- Use a green-family `diffAdded`, red-family `diffRemoved`, and a theme accent for `skill`, while preserving readable separation.
- Set `opaqueWindows` to `false` for the translucent sidebar treatment and `true` for a solid window.

## Portrait-Derived Palette

When a portrait is supplied, derive:

- `surface` from its calmest light and dark neutral;
- `ink` from the highest-contrast wardrobe, hair, or background neutral;
- `accent` from one restrained wardrobe or environmental color;
- semantic colors independently so code-review meaning remains recognizable.

The portrait is a palette reference only. Built-in Codex theming does not display the image.

## Proven Environment

This workflow was exercised on Microsoft Store package `OpenAI.Codex` version `26.707.3351.0` (application build `26.707.30751`). The script discovers the active Codex CLI and relies on the versioned `config/read` and `config/batchWrite` app-server methods. If a later build rejects a key, stop and re-inspect that build's appearance settings before changing files.

The signed Store package must remain untouched. Before applying a theme, the tool creates a local backup under `$CODEX_HOME/backups/codex-desktop-theme` and records the post-apply hash. Rollback refuses if `config.toml` changed after the apply operation, unless the user explicitly approves `--force`; this prevents a theme rollback from silently overwriting newer settings.
