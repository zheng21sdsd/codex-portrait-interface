# Security policy

## Supported versions

Security fixes are made on the latest released `0.x` line. Layout-copy is experimental and is supported only for the Store versions listed in [`docs/compatibility.md`](docs/compatibility.md).

## Reporting a vulnerability

Do not disclose exploitable details in a public issue. Use GitHub's private vulnerability-reporting flow for this repository. Include the release tag or commit, platform, Codex Store version, reproduction steps, expected impact, and any safe proof of concept.

Do not include private images, Codex archives, `manifest.json`, profiles, API keys, conversations, or runtime logs in the report. A maintainer should acknowledge a valid report within seven days and coordinate a fix before public disclosure.

## Security boundaries

This project is not a sandbox and cannot provide a security guarantee for a future Codex build. The safety checks are regression checks for the project's own injected assets. Never run a modified copy from an untrusted repository or bypass an unsupported-version warning without reviewing the code and risk.
