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
- Microsoft Edge, or Chrome with `PLAYWRIGHT_BROWSER_CHANNEL=chrome`.
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
Copy-Item .env.example .env
```

Set `CENBLU_ROOT` in `.env` to the absolute checkout path. The default SQLite URL is relative to the Prisma schema and resolves to `storage/cenblu.db`.

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
| `PLAYWRIGHT_PROFILE_PATH` | Collector Edge user-data root |
| `PLAYWRIGHT_PROFILE_DIRECTORY` | Collector internal profile, such as `Profile 1` |
| `PUBLISHER_PROFILE_PATH` | Separate publisher Edge user-data root |
| `PUBLISHER_PROFILE_DIRECTORY` | Optional publisher internal profile |
| `PUBLISH_MODE` | `ASSISTED` or `AUTOMATIC` |
| `DOWNLOAD_CONCURRENCY` | Parallel download workers, from 1 to 3 |
| `DOWNLOAD_BATCH_LIMIT` | Maximum download attempts per cycle |
| `VIDEO_STORAGE_PATH` | Final media directory |
| `BACKUP_STORAGE_PATH` | SQLite snapshot directory |

Dashboard settings override corresponding `.env` values. Restart the dashboard after changing `.env`, especially browser profile paths.

## Browser Profiles

Collector and publisher profiles must be separate. Close every Edge window and background process before opening, cloning, checking, or using a Cenblue profile.

### Collector

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

### Fresh Publisher

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

### Clone An Existing Edge Profile

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

1. Add accounts under **Sources**.
2. Collect posts and process downloads from **Queue**.
3. Inspect downloaded media under **Downloads** or **Videos**.
4. Edit captions and approve posts under **Review**.
5. Publish manually or assign a future schedule.
6. Inspect successful output under **Published**.

The **Compose** page publishes original text or one image through the publisher profile without creating a video pipeline job.

## Scheduled Publishing

Automatic scheduled publishing requires all of the following:

- Effective `PUBLISH_MODE=AUTOMATIC` in dashboard settings.
- A successful `pnpm publisher:session-check`.
- An approved job with a non-null schedule at or before the current time.
- The dashboard running continuously.
- A closed, authenticated, and available publisher profile.
- Valid local media and caption data.

The dashboard checks due jobs every 30 seconds. Future jobs remain untouched. Do not run the recurring dashboard publisher and `pnpm pipeline` as competing scheduler owners unless you understand the lease behavior.

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
| `pnpm db:migrate` | Apply SQLite migrations |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm db:backup` | Create a database-only snapshot |
| `pnpm storage:audit` | Verify local media paths, sizes, and checksums |
| `pnpm storage:clean` | Remove stale partial download files |

## Database Snapshots

```powershell
pnpm db:backup
```

This runs SQLite `VACUUM INTO` and creates `storage/backups/cenblu-<timestamp>.db`. It does not include videos, thumbnails, logs, or browser profiles. Copy important snapshots outside the project directory to protect against accidental project-folder deletion.

## Quality Checks

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dashboard:routes:smoke
```

Tests use separate databases under `storage/temp`; never point test commands at a real Cenblue database.

## Troubleshooting

### Profile In Use

Close all Edge windows and background processes. Collector and publisher user-data roots must be distinct.

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

## Architecture

| Directory | Responsibility |
| --- | --- |
| `apps/dashboard` | Next.js dashboard, Server Actions, APIs, and automatic publisher loop |
| `workers` | Collector, downloader, publisher, pipeline, and maintenance CLIs |
| `packages/config` | Environment validation and protected path resolution |
| `packages/database` | Prisma repositories, leases, settings, and SQLite migrations |
| `packages/collector` | X collection and normalization |
| `packages/downloader` | Media download, validation, and placement |
| `packages/publisher` | Captioning and Playwright publication |
| `packages/scheduler` | Pipeline cadence and review scheduling |
| `packages/operations` | Backup, audit, deletion, purge, and reset operations |
| `packages/shared` | Logs, diagnostics, leases, and shared contracts |

See [docs/architecture.md](docs/architecture.md) and [docs/operations.md](docs/operations.md).

## Security And Legal Responsibility

Use Cenblue only with accounts and content you are authorized to access. You are responsible for X's terms, copyright, privacy, consent, attribution, and applicable law. The GPL license covers Cenblue's source code; it grants no rights to downloaded or published media.

Report security issues according to [SECURITY.md](SECURITY.md). Do not include cookies, tokens, `.env`, databases, screenshots, logs, or media in public reports.

## License

Copyright (C) 2026 momons2x. Licensed under [GPL-3.0-only](LICENSE).
