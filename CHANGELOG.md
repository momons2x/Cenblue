# Changelog

Notable changes will be documented here. Cenblue has not published its first tagged release yet.

The project intends to follow semantic versioning once release automation is established.

## Unreleased

### Added

- First-class multiple Collector and Publisher identities with isolated profiles, source ownership, account verification, profile-scoped leases, and dashboard health cards.
- Publisher identities enabled for automatic publishing by default, with amber Queue warnings naming the blocking condition for past-due jobs that cannot auto-publish.
- Multi-Publisher review targeting with independent jobs, schedules, retries, queue identity labels, and publication history.
- Explicit profile-file states, deletion success feedback, safe quarantine removal, and identity-preserving clear-all browser profile cleanup.
- Dashboard-managed browser setup with independent Collector and Publisher selection, Windows discovery for common Chromium browsers, custom executable validation, isolated profiles, login launch, session verification, and profile reset.
- Browser-bound session verification that records the authenticated X account and invalidates stale verification after binding changes.
- Compact Review cards with an accessible modal for caption drafts, scheduling, approval, and queue actions, plus a configurable video preview hidden by default.
- Optional per-video FFmpeg compression during Review. Validated H.264/AAC output replaces the active file only when smaller.
- A guided `pnpm setup` workflow for local configuration, storage creation, migrations, media-tool detection, and optional Edge session setup.
- Versioned `config:export` and `config:import` commands for portable preferences and managed source rules.
- Expandable overflow-safe captions on Review and Overview, responsive Tailwind layouts, and semantic light/dark color tokens.
- Native date and time schedule inputs using `APP_TIMEZONE`, past-due auto-publish warnings on the Queue, and atomic bulk approval.
- Responsive Published cards with expandable captions, media details, performance metrics, and recovery actions.
- An in-modal compression activity bar that locks conflicting Review controls while FFmpeg is running.

### Changed

- Playwright and authenticated `yt-dlp` launches now follow the selected Chromium browser instead of assuming Microsoft Edge globally.
- Unscheduled approvals are manual-only across dashboard and pipeline workers.
- Confirmation controls use non-blocking React state instead of browser disclosure behavior.

### Security

- Restrict database-backed runtime overrides to an explicit configuration allowlist.
- Exclude browser credentials, session-verification timestamps, media, operational history, and machine paths from portable manifests.
