# Architecture

Cenblue is a pnpm TypeScript monorepo built around a local SQLite database and filesystem.

The normal data flow is `SourceAccount` → `SourcePost` → `DownloadJob` → `MediaAsset` → `PublishJob` → `PublishedPost`. Repository methods own lifecycle transitions and use transactions where multiple records must remain synchronized.

The collector and publisher each receive a separate Playwright persistent profile protected by database-backed leases. Download and publish jobs use explicit claim states, retry timing, and stale-work recovery. Uncertain publication results require manual attention rather than blind retries.

The dashboard provides operator workflows through Next.js Server Actions. Dedicated workers expose the same services for one-off or recurring operation. SQLite and repository-local media are suitable for one trusted machine; they are not a distributed queue or storage system.

Review is split across a server-rendered queue and a client-side card/dialog interface. Caption, schedule, and lifecycle mutations remain Server Actions so repository and state validation stay authoritative. Manual compression creates a temporary FFmpeg candidate, validates its metadata and hashes, moves it into video storage, conditionally switches the `MediaAsset` record, and removes the old file only after that switch succeeds.

Configuration has two scopes. Device bindings such as repository, executable, storage, and browser-profile paths remain in the ignored local environment file. Portable dashboard preferences and managed source rules can be represented by a versioned manifest; imports pass a strict schema and never carry browser credentials, session-verification timestamps, media, or machine paths.

See `packages/database/prisma/schema.prisma` for the authoritative data model and `docs/operations.md` for operational limitations.
