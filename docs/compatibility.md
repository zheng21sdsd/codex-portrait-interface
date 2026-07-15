# Compatibility

## Stable path: theme mode

Theme mode is intended for Codex desktop builds that expose the documented appearance configuration through the local app-server interface. If a build rejects a key, stop and inspect that build's appearance settings rather than editing configuration files manually.

## Experimental path: layout-copy

| Requirement | Supported value |
| --- | --- |
| Operating system | Windows 10 or Windows 11 |
| Distribution | Microsoft Store package `OpenAI.Codex` |
| Tested Store package | `26.707.3351.0` |
| Node.js | `>=22.12.0` for `@electron/asar` 4.2.0 |
| Python | 3.10+ with Pillow 11.0.0 |

The experimental implementation depends on the Store application's current archive layout, webview entrypoint, and executable name. New Store versions are deliberately rejected by `install` until tested, unless the user explicitly supplies `--allow-unsupported-version` after a deliberate review. That switch is not a compatibility guarantee.

To request support for a new version, open an issue with the non-sensitive output of `doctor`, the Store version, and the behavior observed. Do not attach archives, profiles, logs, screenshots containing private data, or background images.
