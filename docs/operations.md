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

## Restore Outline

Stop the dashboard and all workers. Preserve the current database, select a verified snapshot, copy it to the configured database path, apply pending migrations, start in Assisted mode, run a storage audit, and inspect all active publication jobs before enabling Automatic mode.

Test restoration on a copy before treating it as a supported recovery process.
