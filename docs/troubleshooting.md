# Troubleshooting

Start with the dashboard Logs page and the component logs under `storage/logs`.

## Browser Failures

Close all Edge processes for profile-in-use errors. Use repository-local clones instead of Edge's default user-data root. Run the matching session check after login and restart the dashboard after `.env` changes.

## Queue Failures

Inspect `lastError`, attempt count, retry time, and current status. Never force a `COMPLETED` publication. Verify X before resolving `MANUAL_ATTENTION`.

## Database Failures

Confirm `DATABASE_URL` points to the intended file. A zero-byte database is not a valid Cenblue database. Preserve unexpected files before migrations or recovery work.

## Media Failures

Verify the external tools, storage paths, free space, and checksums. Run `pnpm storage:audit`; do not manually rewrite database file paths unless the corresponding files have been moved safely.
