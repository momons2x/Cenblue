# Operations

## Recommended Topology

Run the dashboard for operator access and its scheduled publisher. Use one recurring pipeline owner only; avoid running the dashboard automatic publisher and `pnpm pipeline` as competing long-lived schedulers.

Keep `PUBLISH_MODE=ASSISTED` until the publisher session, captions, review flow, and scheduled behavior have been verified.

## Routine Checks

- Confirm collector and publisher sessions after account challenges or profile changes.
- Review Queue failures and `MANUAL_ATTENTION` before retrying.
- Monitor free disk space and `storage/logs`.
- Run `pnpm storage:audit` after moving media or restoring a database.
- Create snapshots with `pnpm db:backup` before migrations and significant maintenance.

## New Device Setup

Run `pnpm setup` after installing dependencies. The wizard detects or requests `yt-dlp`, FFmpeg, and FFprobe, creates local storage, writes the ignored `.env`, applies migrations, and can guide fresh Edge sessions. Collector and publisher browser identities must remain separate.

Move non-secret preferences and managed sources with:

```powershell
pnpm config:export
pnpm config:import .\cenblu-preferences.json
```

Import merges managed sources and invalidates collector and publisher session-verification timestamps. It does not transfer media, database history, jobs, browser profiles, cookies, logs, or machine-specific paths. Run both session checks on the destination device before enabling Automatic mode.

## Review Compression

Compression is a manual Review action and may run for several minutes. Do not stop the dashboard while FFmpeg is active. Cenblue keeps the original active while producing and validating the candidate, discards candidates that are not smaller, and disables repeat compression after a successful replacement. Run `pnpm storage:audit` if the process or machine stops during file replacement.

## Restore Outline

Stop the dashboard and all workers. Preserve the current database, select a verified snapshot, copy it to the configured database path, apply pending migrations, start in Assisted mode, run a storage audit, and inspect all active publication jobs before enabling Automatic mode.

Test restoration on a copy before treating it as a supported recovery process.
