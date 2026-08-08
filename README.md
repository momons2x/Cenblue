# Cenblue

[Cenblue](https://github.com/momons2x/Cenblue) is a local-first workspace for collecting video posts from X, downloading and validating media, reviewing captions, scheduling publications, and publishing through isolated browser profiles.

> [!WARNING]
> Cenblue's dashboard has no authentication. Run it only on a trusted local machine and do not expose it directly to the Internet. Browser profiles contain account sessions, and `storage/` contains private operational data. Neither belongs in Git, issues, or support requests.

## Features

- Collect video posts from configured X accounts and bookmarks.
- Download through `yt-dlp`, validate through FFmpeg/FFprobe, and retain checksums.
- Review media and captions before approval.
- Schedule approved posts or publish them manually.
- Compose original text and single-image posts.
- Track durable download and publication states in SQLite.
- Inspect progress, logs, diagnostics, local media, and publication history.
- Create consistent SQLite snapshots with `pnpm db:backup`.

## Requirements

- Windows 10 or 11 for the supported Edge profile setup workflow.
- Node.js 22.12 or newer.
- pnpm 10.12.1 through Corepack.
- A Chromium-based browser such as Microsoft Edge, Chrome, Brave, Chromium, Vivaldi, or Opera.
- `yt-dlp`, `ffmpeg`, and `ffprobe` on `PATH`, or their paths configured in `.env`.
- Enough disk space for the SQLite database, browser profiles, videos, thumbnails, logs, and backups.
- X accounts you are authorized to access and content you have the right to download and publish.

## Install

```powershell
git clone https://github.com/momons2x/Cenblue.git
Set-Location Cenblue
corepack enable
corepack prepare pnpm@10.12.1 --activate
pnpm install --frozen-lockfile
pnpm setup
```

The guided setup detects the repository and media binaries, creates runtime storage, writes the ignored local `.env`, and applies database migrations. Add Collector and Publisher identities and log into X from the dashboard under **Settings → Isolated X identities**. Manual `.env` setup remains available through `.env.example`.

## Storage Setup

Create the runtime directories before the first migration:

```powershell
New-Item -ItemType Directory -Force storage, storage\videos, storage\thumbnails, storage\temp, storage\logs, storage\backups
pnpm db:migrate
```

| Path | Purpose |
| --- | --- |
| `storage/cenblu.db` | SQLite application database |
| `storage/videos/` | Validated MP4 files named by X post ID |
| `storage/thumbnails/` | Downloaded thumbnails |
| `storage/temp/` | Partial downloads, test databases, and temporary uploads |
| `storage/logs/` | Rotating logs and browser diagnostics |
| `storage/backups/` | Timestamped SQLite snapshots |
| `storage/browser-profile-*` | Sensitive local Edge sessions |

The complete `storage/` tree is ignored by Git except its placeholder. Never force-add storage files.

## Environment

`.env.example` documents every supported variable. Important settings include:

| Variable | Meaning |
| --- | --- |
| `CENBLU_ROOT` | Absolute repository path |
| `DATABASE_URL` | Prisma SQLite URL |
| `PLAYWRIGHT_PROFILE_PATH` | Legacy/fallback collector browser user-data root |
| `PLAYWRIGHT_PROFILE_DIRECTORY` | Collector internal profile, such as `Profile 1` |
| `PUBLISHER_PROFILE_PATH` | Legacy/fallback publisher browser user-data root |
| `PUBLISHER_PROFILE_DIRECTORY` | Optional publisher internal profile |
| `PUBLISH_MODE` | `ASSISTED` or `AUTOMATIC` |
| `DOWNLOAD_CONCURRENCY` | Parallel download workers, from 1 to 3 |
| `DOWNLOAD_BATCH_LIMIT` | Maximum download attempts per cycle |
| `VIDEO_STORAGE_PATH` | Final media directory |
| `BACKUP_STORAGE_PATH` | SQLite snapshot directory |

Dashboard settings override corresponding `.env` values. Browser choices made in the dashboard are device-local, use generated profiles under `storage/browser-profiles/`, and are excluded from portable exports.

### Portable Preferences

Move non-secret preferences and managed source rules to another device without copying browser credentials or machine paths:

```powershell
pnpm config:export
pnpm config:import .\cenblu-preferences.json
```

The versioned manifest excludes videos, thumbnails, operational history, browser profiles, session-verification timestamps, logs, and absolute paths. Run `pnpm setup` and log into both isolated X profiles separately on every device.

## Browser Profiles

Every Collector and Publisher identity uses a separate managed profile. Cenblue can detect common Chromium-based browsers on Windows, run up to two Collector identities together from dashboard collection actions, and serialize Publisher uploads through independently owned jobs.

### Dashboard Setup

After starting Cenblue, open **Settings → Isolated X identities**:

1. Add a Collector or Publisher with a label, expected X username, and detected/custom browser.
2. Select **Create and log in**, then complete X login in the isolated browser window.
3. Close that browser window completely.
4. Select **Verify identity**. The active X username must exactly match the configured identity.

Verification records the authenticated X account and is bound to the exact executable and managed profile. Changing browsers, opening login setup, resetting a profile, or importing portable preferences invalidates the previous verification. Automatic publishing remains disabled until the current publisher binding is verified.

The managed profiles contain sensitive cookies and remain under `storage/browser-profiles/<role>/<identity-id>`. Cenblue never automates the browser's everyday user-data directory. Sources are assigned to one Collector, bookmark scans explicitly select a Collector, and Review can create independent jobs for several Publisher identities.

Deleting one local profile preserves its identity, assignments, jobs, and history. **Clear all managed browser profiles** removes all managed cookies and login files after the typed `DELETE ALL PROFILES` confirmation while preserving identity records and operational data.

The CLI workflows below remain available for legacy profiles and recovery.

### Legacy Collector

Configure a repository-local profile:

```env
PLAYWRIGHT_PROFILE_PATH="./storage/browser-profile-collector"
PLAYWRIGHT_PROFILE_DIRECTORY="Profile 1"
```

Then open it, log into the collector account, close Edge completely, and verify it:

```powershell
pnpm collector:profile:open
pnpm collector:session-check
```

### Legacy Fresh Publisher

Use a different directory and leave `PUBLISHER_PROFILE_DIRECTORY` unset:

```env
PUBLISHER_PROFILE_PATH="./storage/browser-profile-publisher"
# PUBLISHER_PROFILE_DIRECTORY is intentionally unset
```

```powershell
pnpm publisher:login
pnpm publisher:session-check
```

Complete login in the visible browser and follow the terminal prompt. The session check records the verification required by automatic publishing.

### Legacy Edge Profile Clone

Never point Playwright directly at Edge's default `User Data` directory. Edge rejects remote debugging there. Instead, clone one internal profile into an unused repository-local destination:

```env
PLAYWRIGHT_PROFILE_SOURCE_PATH="C:/Users/you/AppData/Local/Microsoft/Edge/User Data"
PUBLISHER_PROFILE_PATH="./storage/browser-profile-publisher"
PUBLISHER_PROFILE_DIRECTORY="Profile 2"
PLAYWRIGHT_ALLOW_EXTERNAL_PROFILE=false
```

```powershell
pnpm publisher:profile:clone
pnpm publisher:session-check
```

The source is read-only. The destination must not already exist and is never overwritten. If the cloned session is not authenticated, run `pnpm publisher:profile:open`, log into X, close Edge, and rerun the session check.

Session cookies are local-only. This repository does not include the owner's browser profile or account session.

## Run

```powershell
pnpm dev
```

Open <http://127.0.0.1:3000>. Dashboard scripts explicitly bind to loopback; this is a safety boundary, not a substitute for authentication. A normal workflow is:

1. Add and verify browser identities under **Settings**.
2. Add accounts under **Sources** and assign each one to a Collector.
3. Collect posts and process downloads from **Queue**.
4. Inspect downloaded media under **Downloads** or **Videos**.
5. Edit captions, select one or more Publishers, and approve posts under **Review**.
6. Publish manually or assign a future schedule.
7. Inspect account-specific output under **Published**.

Review uses responsive compact cards for size, duration, and caption scanning. Long captions wrap safely and can expand in place. Open a card to save caption drafts, schedule approval, or run optional balanced FFmpeg compression. Video preview is hidden by default and can be shown per item or enabled by default through the **Preview behavior** setting under **Settings → Review**. Compression shows an in-modal activity bar, validates a new MP4, and replaces the active file only when the result is smaller.

The **Compose** page publishes original text or one image through one or more explicitly selected Publisher identities without creating a video pipeline job.

The **Overview** page shows live status for the CLI workers (collector, downloader, publisher, pipeline) from their runtime heartbeats. The dashboard exposes a minimal health endpoint at `/api/health` returning the application version, timezone, database and storage availability, and pending work counts; the application version also appears in the sidebar footer.

Download batches run in the background: **Process pending now** on the Queue, per-job **Download now**, and bulk retry-downloads start the work in the dashboard process and return immediately, so navigation stays responsive while media downloads. A live progress bar follows you on every page until the batch finishes, and the Queue acknowledges the run with a status toast. Only one run can be active at a time; pressing the action again while a run is live shows the ongoing progress instead of starting a second batch.

## Scheduled Publishing

Automatic scheduled publishing requires all of the following:

- Effective `PUBLISH_MODE=AUTOMATIC` in dashboard settings.
- At least one enabled Publisher identity that is verified from the dashboard and enabled for automatic publishing.
- An approved job with a non-null schedule at or before the current time.
- The dashboard running continuously.
- A closed, authenticated, account-matched, and available target Publisher profile.
- Valid local media and caption data.

New Publisher identities start with automatic publishing enabled, but remain inactive until they are verified from the dashboard. If a due job cannot auto-publish, the Queue shows an amber warning row naming the blocking condition, such as Publish mode not being Automatic, an unassigned, paused, not-automatic, unverified, or deleted Publisher identity, or a retry that is not yet due.

The dashboard checks due jobs every 30 seconds. Future jobs remain untouched. Do not run the recurring dashboard publisher and `pnpm pipeline` as competing scheduler owners unless you understand the lease behavior.

All schedule controls use the configured `APP_TIMEZONE` with native date and time inputs. Approval without a date is manual-only and requires the Queue's explicit **Publish now** action; automatic workers process only due jobs with a schedule.

### Batch Scheduling

Instead of assigning each post a time by hand, approve a set of posts at once and let Cenblue **shuffle them and auto-assign staggered times** across a day:

1. Select posts on the **Review** page and open **Bulk actions → Batch schedule**.
2. Pick the schedule day (defaults to today) and optionally enter **Posts today** to override the global daily settings.
3. Choose Publisher targets and approve.

Cenblue shuffles the selected posts, spreads them evenly across the **active window**, and adds **random jitter** so the timing looks human. Nothing posts during the quiet hours between the window's end and the next day's start. Configure the window and jitter under **Settings → Publishing → Batch schedule**:

- `SCHEDULE_ACTIVE_START` / `SCHEDULE_ACTIVE_END` — the only hours posts can land (default `09:00`–`22:00`; this is the "no posts overnight" quiet period).
- `SCHEDULE_JITTER_MINUTES` — random ±offset per slot (default `10`).
- `SCHEDULE_MIN_GAP_MINUTES` — minimum spacing between posts (default `15`).
- `DAILY_POST_MINIMUM` / `DAILY_POST_PREFERRED` — the default number of posts when no per-batch override is given.

Batch scheduling is platform-neutral: it only writes each job's schedule, so it works for X publishers and future platform targets alike.

Published history uses responsive cards with expandable captions, media details, performance metrics, and recovery actions.

## Notifications

Cenblue can send Telegram alerts when a publish job succeeds or fails and needs attention. Setup:

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Set `TELEGRAM_BOT_TOKEN` in the local `.env` and restart the dashboard. The token never enters the database or portable exports.
3. Under **Settings → Notifications**, enable alerts and set your Telegram chat ID (the number in a chat link such as `t.me/<user>` or via `@userinfobot`).

Verification and status:

- **Verify connection** (Settings) checks the bot token with the Telegram `getMe` call and confirms the chat is reachable.
- **Send test message** (Settings) delivers a message synchronously and reports the real result instead of just queuing it.
- The Notifications panel shows live status: bot token validity, chat reachability, outbox counts (pending/sending/sent/dead), and the last delivery time or error.
- From the terminal: `pnpm notify:status` prints the same report (and exits non-zero on failure), while `pnpm notify:test` sends a synchronous test message.
- Telegram commands: while the dashboard runs, you can send `/status`, `/pipeline`, `/published`, `/test`, and `/help` to your bot and it replies. The dashboard long-polls the bot for incoming messages; commands are accepted only from the configured `TELEGRAM_CHAT_ID`. This is separate from alerts — it lets you query state from your phone.

Enabled alerts notify on every publish **success and failure** across all publish paths (manual, automatic, and pipeline), marking whether the job waits for manual review or will retry automatically. Success messages include the post URL and ask you to confirm the post is live, since the local media is deleted only after you confirm it on the Published page. Repeated events for the same job are deduplicated, and delivery is retried with backoff. The dashboard checks the outbox every 15 seconds, so notifications follow the dashboard process; keep it running to deliver alerts.

In addition to Telegram, alerts can be delivered to your **Discord DM** through the same outbox. Enable **Settings → Discord → Direct-message alerts**; the bot then DMs `DISCORD_OWNER_ID` on publish failures and successes, and **Send test DM** verifies delivery. Both channels are enabled or disabled independently under the shared master **Notifications** toggle. The **Published** page has a **Send test publish notification** button to verify the success-alert chain.

## Discord Commands

A lightweight Discord bot can answer status commands in your direct message. Setup:

1. Create an application at [discord.com/developers/applications](https://discord.com/developers/applications), open **Bot**, copy the token, and ensure the bot can be DMed. In **Bot → Privileged Gateway Intents**, enable **Message Content Intent** (required for `!` commands).
2. Set `DISCORD_BOT_TOKEN` and `DISCORD_OWNER_ID` in the local `.env` (enable Developer Mode in Discord, right-click your user, **Copy User ID** for the owner ID). Restart the dashboard.
3. The bot connects when the dashboard runs (or start it standalone with `pnpm discord-bot`), then send commands in your DM with the bot using the `!` prefix:

- `!status` — notification status: Telegram token/chat validity, outbox counts, last delivery/error.
- `!pipeline` — pipeline summary: enabled sources, pending/failed downloads, scheduled/attention publishes, published today/total, worker heartbeats.
- `!published` — the latest 10 published posts with their links and whether local media is still present.
- `!test` — send a test notification through the configured Telegram channel.
- `!help` — list commands.

Commands are accepted only from `DISCORD_OWNER_ID` in a direct message. The bot token stays in `.env` and never enters the database or portable exports. When connected, the bot sets an online presence so it appears online in Discord.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the dashboard in development mode |
| `pnpm build` | Build the dashboard for production |
| `pnpm collector` | Run one collector cycle |
| `pnpm source:add -- username 5` | Add a source from the CLI |
| `pnpm downloader` | Process one bounded download cycle |
| `pnpm publisher` | Process one eligible publication |
| `pnpm pipeline:once` | Run one complete pipeline cycle |
| `pnpm pipeline` | Run the recurring pipeline |
| `pnpm db:migrate` | Back up the existing database, then apply SQLite migrations |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm db:backup` | Create a database-only snapshot |
| `pnpm storage:audit` | Verify local media paths, sizes, and checksums |
| `pnpm storage:clean` | Remove stale partial download files |
| `pnpm notify:status` | Print Telegram notification status |
| `pnpm notify:test` | Send a synchronous Telegram test message |
| `pnpm discord-bot` | Run the Discord status bot standalone |

## Database Snapshots

```powershell
pnpm db:backup
```

This runs SQLite `VACUUM INTO` and creates `storage/backups/cenblu-<timestamp>.db`. It does not include videos, thumbnails, logs, or browser profiles. Copy important snapshots outside the project directory to protect against accidental project-folder deletion.

`pnpm db:migrate` also snapshots an existing database before applying migrations, so a failed or unexpected migration can be rolled back from `storage/backups/`. Fresh installs with no existing database skip the snapshot and migrate directly.

## Quality Checks

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm dashboard:routes:smoke
```

Tests use separate databases under `storage/temp`; never point test commands at a real Cenblue database. `pnpm test:coverage` enforces baseline coverage thresholds in CI.

## Troubleshooting

### Profile In Use

Close the Cenblue-managed browser window for that role. Collector and publisher user-data roots must be distinct.

### DevTools Requires A Non-Default Directory

Do not use `C:/Users/.../Microsoft/Edge/User Data` directly as a Playwright profile. Clone the selected profile into `storage/` as described above.

### Publisher Is Not Logged In

Open the isolated publisher profile, complete X login, close Edge, run `pnpm publisher:session-check`, and restart the dashboard if `.env` changed. Verify the X account before retrying a `MANUAL_ATTENTION` job.

### Scheduled Post Does Not Publish

Confirm Automatic mode, publisher verification, due local time, dashboard uptime, local media availability, and the absence of another process holding the publisher profile.

### Missing Database Tables

Confirm `DATABASE_URL`, then run `pnpm db:migrate`. Never migrate an unexpected empty database until you have checked whether the intended database path changed.

### Download Tools Fail

Run `yt-dlp --version`, `ffmpeg -version`, and `ffprobe -version`, or configure explicit binary paths in `.env`.

If a command reports `spawn ... ENOENT`, the configured binary path no longer exists. This commonly happens when media tools were installed through WinGet and their package cache or `WinGet\Links` shims were cleared, deleted, or moved. Fix it by pointing the `.env` variables at real executable paths:

1. Reinstall any missing tool, for example `winget install --id Gyan.FFmpeg --source winget` and `winget install --id yt-dlp.yt-dlp --source winget`.
2. Find the installed executables under `%LOCALAPPDATA%\Microsoft\WinGet\Packages\<package>\bin\` (or the package root for `yt-dlp.exe`). The `WinGet\Links` shims may not exist until the shell restarts, so prefer the real package paths.
3. Set `YTDLP_BINARY`, `FFMPEG_BINARY`, and `FFPROBE_BINARY` in `.env` to those paths, or simply to bare `yt-dlp`, `ffmpeg`, and `ffprobe` if the tools are on `PATH`.
4. Restart the dashboard so it reloads the environment, then run `pnpm downloader:smoke` to confirm.

Prefer PATH-based values (`yt-dlp`, `ffmpeg`, `ffprobe`) in `.env` so future tool updates or cache cleanups do not leave stale absolute paths behind.

## Architecture

| Directory | Responsibility |
| --- | --- |
| `apps/dashboard` | Next.js dashboard, Server Actions, APIs, automatic publisher loop, and `/api/health` |
| `workers` | Collector, downloader, publisher, pipeline, maintenance, setup, migration, notify, and discord-bot CLIs |
| `packages/config` | Environment validation and protected path resolution |
| `packages/database` | Prisma repositories, leases, settings, and SQLite migrations |
| `packages/collector` | X collection and normalization |
| `packages/downloader` | Media download, validation, and placement |
| `packages/publisher` | Captioning and Playwright publication |
| `packages/scheduler` | Pipeline cadence and review scheduling |
| `packages/operations` | Backup, audit, deletion, purge, and reset operations |
| `packages/notifications` | Telegram delivery, outbox dispatch, and notification status |
| `packages/discord-bot` | Owner-only Discord status commands via slash commands |
| `packages/shared` | Logs, diagnostics, leases, and shared contracts |

See [docs/architecture.md](docs/architecture.md), [docs/operations.md](docs/operations.md), and the tracked [production readiness and product roadmap](PRODUCTION_READINESS_PLAN.md).

## Security And Legal Responsibility

Use Cenblue only with accounts and content you are authorized to access. You are responsible for X's terms, copyright, privacy, consent, attribution, and applicable law. The GPL license covers Cenblue's source code; it grants no rights to downloaded or published media.

Report security issues according to [SECURITY.md](SECURITY.md). Do not include cookies, tokens, `.env`, databases, screenshots, logs, or media in public reports.

## License

Copyright (C) 2026 momons2x. Licensed under [GPL-3.0-only](LICENSE).
