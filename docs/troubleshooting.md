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

If Review compression fails, confirm that FFmpeg and FFprobe execute from the configured paths and that both `storage/temp` and `storage/videos` have sufficient free space. The original remains active unless the validated smaller candidate was committed. A "not smaller" result is expected for media that is already efficiently encoded.

## Setup And Import Failures

`pnpm setup` preserves the replaced environment as `.env.previous`. If setup is interrupted, inspect both files before retrying. Portable imports accept only the documented versioned schema; remove machine paths, session fields, media references, and unknown keys rather than bypassing validation. After every import, establish fresh browser sessions and rerun both session checks.
