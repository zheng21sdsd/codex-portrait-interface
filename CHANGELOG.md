# Changelog

All notable changes are documented here. This project follows Keep a Changelog principles and uses semantic versioning for its public release tags.

## [Unreleased]

### Added

- GitHub-ready documentation, governance files, release checks, CI, and privacy guidance.
- Local dependency lockfiles, a read-only `doctor` command, dry-run packaging, compatibility gating, and image-safety tests.

### Changed

- Image inputs are decoded with a real-format, dimension, and pixel-limit check, then re-encoded without metadata.
- Layout manifests no longer retain the original image path or act as an executable-path authority.
- Theme rollback now detects post-apply configuration changes before restoring a backup.

### Security

- Layout rollback only removes a shortcut that proves tool ownership.
- Packaging uses the local lockfile-pinned archive tool instead of runtime `npx` download-and-execute behavior.

## [0.1.0] - 2026-07-16

### Added

- Initial public release of theme mode and experimental Windows layout-copy mode.
