# Privacy

## Data handled locally

Layout-copy reads a background image only when the user explicitly asks for it. It validates the real image format, limits decode dimensions and pixels, samples its colours, removes metadata, and stores a re-encoded PNG inside the local experimental app copy.

The original source path is not written to the new install manifest or standard command output. The image's visual pixels remain in the local app copy until the user runs layout rollback or removes that copy.

Theme mode reads and backs up the local Codex configuration. Configuration backups may contain sensitive values depending on the user's Codex setup. They stay under the local Codex home directory and must never be committed or shared.

## Verification data

`verify` launches an isolated local profile with runtime logging to collect passive-skin evidence. It deletes that profile and log by default. `--keep-preview` retains them only for explicit troubleshooting.

The project does not intentionally collect conversation text, credentials, or telemetry. Do not treat that as a promise about Codex itself or other software on the machine.

## Reporting safely

Before sharing output publicly, remove absolute paths, hashes of private images, conversation content, account information, application archives, profile files, and logs. Never attach `manifest.json`, a personal background, or a Codex screenshot containing private content to a public issue.
