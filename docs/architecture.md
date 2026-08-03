# Architecture

Cenblue is a pnpm TypeScript monorepo built around a local SQLite database and filesystem.

The normal data flow is `SourceAccount` → `SourcePost` → `DownloadJob` → `MediaAsset` → `PublishJob` → `PublishedPost`. Repository methods own lifecycle transitions and use transactions where multiple records must remain synchronized.

The collector and publisher each receive a separate Playwright persistent profile protected by database-backed leases. Download and publish jobs use explicit claim states, retry timing, and stale-work recovery. Uncertain publication results require manual attention rather than blind retries.

The dashboard provides operator workflows through Next.js Server Actions. Dedicated workers expose the same services for one-off or recurring operation. SQLite and repository-local media are suitable for one trusted machine; they are not a distributed queue or storage system.

See `packages/database/prisma/schema.prisma` for the authoritative data model and `docs/operations.md` for operational limitations.
