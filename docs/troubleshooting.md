# Troubleshooting

## `doctor` says `needs-setup`

Run the dependency setup from the installed skill directory:

```powershell
npm ci
py -3 -m pip install -r requirements.txt
node scripts\codex-layout-copy.mjs doctor --json
```

Use a supported Node version; `@electron/asar` 4.2.0 requires Node 22.12 or later.

## Store version is untested

Do not use `--allow-unsupported-version` as a routine workaround. Wait for a tested release or evaluate the new layout in an isolated development environment. Theme mode remains the safer option.

## A background is rejected

Use a real PNG, JPEG, or WebP image smaller than 50 MB, no wider or taller than 8192 pixels, and no more than 24 megapixels. The tool checks the decoded format, not just the filename extension.

## Layout verification fails

Run `status --json`, confirm that the Store has not updated, then run `verify --json` again. A route reported as `not-exercised` is coverage information, not a visual pass. Do not use Windows UI automation to force a route for testing.

## Rollback refuses

For theme mode, Codex configuration changed after applying the theme. Review the backup before deciding whether `--force` is appropriate. For layout-copy, close **Codex Personal** first. An unrecognized Start Menu shortcut is deliberately preserved; remove it manually only after confirming it is safe.
