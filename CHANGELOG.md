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
- A guided `pnpm setup` workflow for local configuration, storage creation, migrations, media-tool detection, and dashboard-managed identity guidance.
- Versioned `config:export` and `config:import` commands for portable preferences and managed source rules.
- Expandable overflow-safe captions on Review and Overview, responsive Tailwind layouts, and semantic light/dark color tokens.
- Native date and time schedule inputs using `APP_TIMEZONE`, past-due auto-publish warnings on the Queue, and atomic bulk approval.
- Responsive Published cards with expandable captions, media details, performance metrics, and recovery actions.
- An in-modal compression activity bar that locks conflicting Review controls while FFmpeg is running.
- Download claim fencing with per-claim tokens and heartbeats, so long downloads are not reclaimed as stale and results are persisted only by the current claim holder.
- A `/api/health` endpoint reporting the application version, timezone, database and storage availability, and pending work counts.
- Worker runtime heartbeats from the collector, downloader, publisher, and pipeline CLIs, shown live on the Overview page, with the application version in the sidebar footer.
- Automatic pre-migration database snapshots from `pnpm db:migrate`.
- Test coverage reporting with baseline thresholds via `pnpm test:coverage`.
- Telegram notifications for publish failures that need attention, with deduplication, retry backoff, an outbox driven by the dashboard loop, and a test-message action in Settings.
- Telegram verification and status: bot-token and chat checks via `getMe`/`getChat`, a live outbox status block in Settings, synchronous test delivery, and `pnpm notify:status` / `pnpm notify:test` CLI commands.
- A Discord status bot (`@cenblu/discord-bot`) that answers owner-only slash commands in a direct message: `/status`, `/pipeline`, `/test`, and `/help`, started with the dashboard or standalone via `pnpm discord-bot`.
- Discord direct-message alerts: publish notifications can be delivered to the owner's DM through the bot, enabled and tested from a Discord panel in Settings alongside Telegram.
- Publish-success notifications: successful publishes now alert all configured channels, with a **Send test publish notification** button on the Published page to verify the chain.
- Discord bot commands moved from slash to `!` prefix commands (`!status`, `!pipeline`, `!test`, `!help`), with an explicit online presence so the bot shows as online in Discord.
- Telegram commands: the dashboard long-polls `getUpdates` and answers `/status`, `/pipeline`, `/published`, `/test`, and `/help` for the configured chat, so state can be queried from the phone.
- Success notifications now fire on **every** publish path (manual, automatic, and pipeline), sending the post URL to all configured channels with a prompt to confirm the post is live before local media is deleted. A `published` command (Telegram `/published`, Discord `!published`) lists the latest published posts with links and local-media state.
- Batch scheduling with a humanizer: shuffle a set of approved posts and auto-assign staggered times across a configurable active window with random jitter and a minimum gap, plus a per-batch "posts today" override.
- Review queue sorting: sort by newest or oldest post date, alongside the existing newest-updated, size, duration, caption-length, and source sorts.

### Changed

- Playwright and authenticated `yt-dlp` launches now follow the selected Chromium browser instead of assuming Microsoft Edge globally.
- Unscheduled approvals are manual-only across dashboard and pipeline workers.
- Confirmation controls use non-blocking React state instead of browser disclosure behavior.
- `pnpm setup` no longer guides legacy browser sessions; identities and X logins are configured from the dashboard under **Settings → Isolated X identities**.

### Security

- Restrict database-backed runtime overrides to an explicit configuration allowlist.
- Exclude browser credentials, session-verification timestamps, media, operational history, and machine paths from portable manifests.
