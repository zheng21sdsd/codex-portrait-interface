# Change Request: README visual examples

Date: 2026-07-16 01:20
Status: Verified

## User Request

Add images and example results to the public README.

## Goal

Show a clear, public-safe before/after-style visual example and a concise usage path so prospective users can understand the skinning result before installing the skill.

## Non-Goals

- Change Codex runtime behavior or apply a new skin.
- Publish user conversations, private paths, personal images, application binaries, or unredacted screenshots.

## Current Context

- The README currently documents modes, installation, safety, and rollback but has no visual demonstration.
- The repository is public and must keep the existing privacy and non-affiliation boundaries.

## Proposed Change

1. Select public-safe example screenshot material from user-authorized local captures.
2. Remove identifying and content-bearing regions before adding optimized image assets under `docs/images/`.
3. Add an "Example result" section to README with image alt text, a concise caption, and a dry-run/install/verify example.
4. Update repository validation to allow intentional documentation images while keeping arbitrary user image artifacts excluded.

## Affected Areas

- `README.md`
- `docs/images/`
- `scripts/verify-release.mjs`
- `.gitignore` and release documentation as needed

## Validation Plan

- Inspect exported image assets for readable text, personal paths, and unexpected metadata.
- Verify Markdown image paths exist and render-relative paths are correct.
- Run release-tree validation, image tests, and Git diff checks.

## Risks And Rollback

- Screenshots can disclose private information or misrepresent supported behavior. Use sanitized, clearly labelled example assets only.
- If the result does not meet the privacy review, remove the image assets and README section in a follow-up revert.

## Implementation Notes

- Added `docs/images/portrait-interface-example.png`, a sanitized illustrative visual derived from an approved theme reference. It contains abstract placeholder bars only; it does not contain a conversation, account name, local path, terminal output, file name, or user-supplied background asset.
- Added an "Example result" section to `README.md`, with accessible alt text, an explicit non-official/sanitized caption, composition notes, and a command-to-result workflow table.
- Replaced the README clone placeholder with the published GitHub repository URL.
- Extended the release validator to require the documented example asset, permit images only under `docs/images/`, and reject PNG EXIF/text chunks that could carry private metadata.

## Verification Results

- Visually inspected the committed documentation image and confirmed it has no readable private or identifying content.
- `node --check scripts/verify-release.mjs` passed.
- `node scripts/verify-release.mjs` passed with 40 public files and no release-tree problems, including the documentation image metadata check.
- `git diff --check` passed.
