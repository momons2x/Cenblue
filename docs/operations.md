# Operations

## Recommended Topology

Run the dashboard for operator access and its scheduled publisher. Use one recurring pipeline owner only; avoid running the dashboard automatic publisher and `pnpm pipeline` as competing long-lived schedulers.

Keep `PUBLISH_MODE=ASSISTED` until the publisher session, captions, review flow, and scheduled behavior have been verified.

## Routine Checks

- Confirm collector and publisher sessions after account challenges or profile changes.
- Review Queue failures, `MANUAL_ATTENTION`, and amber past-due warnings before retrying.
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

After the dashboard starts, configure identities from **Settings → Isolated X identities**. Add as many Collector and Publisher identities as needed, open each managed profile, log into the exact configured X username, close the browser, and verify it. Publisher identities are enabled for automatic publishing by default. Sources must be assigned to one Collector; Review explicitly selects Publisher targets. A browser change or profile deletion invalidates only that identity's verification.

Use **Delete local profile** to remove one identity's cookies while preserving assignments and jobs. Use **Clear all managed browser profiles** with the typed confirmation to remove every managed profile, including inactive directories. Neither operation removes videos, sources, jobs, or publication history.

## Review Compression

Compression is a manual Review action and may run for several minutes. The modal displays an activity bar and locks conflicting actions until FFmpeg, validation, and file replacement finish. Do not stop the dashboard while FFmpeg is active. Cenblue keeps the original active while producing and validating the candidate, discards candidates that are not smaller, and disables repeat compression after a successful replacement. Run `pnpm storage:audit` if the process or machine stops during file replacement.

Video preview in the Review modal is hidden by default. Set **Settings → Review → Preview behavior** to show it by default, or toggle **Show video preview** inside each review item.

## Scheduling

Set a valid IANA `APP_TIMEZONE` in Settings before relying on automatic publishing. Schedule controls use native date and time inputs in that timezone on every device. A blank Review schedule is manual-only; use **Publish now** from Queue when ready. Automatic dashboard and pipeline owners process only due jobs with a non-null schedule. The Queue marks a due job that auto-publishing cannot run with an amber warning row naming the blocking condition, so check those rows first when a scheduled post is missing.

## Restore Outline

Stop the dashboard and all workers. Preserve the current database, select a verified snapshot, copy it to the configured database path, apply pending migrations, start in Assisted mode, run a storage audit, and inspect all active publication jobs before enabling Automatic mode.

Test restoration on a copy before treating it as a supported recovery process.
