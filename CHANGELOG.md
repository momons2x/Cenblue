# Changelog

Notable changes will be documented here. Cenblue has not published its first tagged release yet.

The project intends to follow semantic versioning once release automation is established.

## Unreleased

### Added

- Compact Review cards with an accessible modal for video preview, caption drafts, scheduling, approval, and queue actions.
- Optional per-video FFmpeg compression during Review. Validated H.264/AAC output replaces the active file only when smaller.
- A guided `pnpm setup` workflow for local configuration, storage creation, migrations, media-tool detection, and optional Edge session setup.
- Versioned `config:export` and `config:import` commands for portable preferences and managed source rules.

### Security

- Restrict database-backed runtime overrides to an explicit configuration allowlist.
- Exclude browser credentials, session-verification timestamps, media, operational history, and machine paths from portable manifests.
