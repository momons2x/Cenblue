# Architecture

Cenblue is a pnpm TypeScript monorepo built around a local SQLite database and filesystem.

The normal data flow is `BrowserIdentity(COLLECTOR)` → assigned `SourceAccount` → `SourcePost` → `DownloadJob` → `MediaAsset` → review job → account-scoped `PublishJob` targets → `PublishedPost`. Repository methods own lifecycle transitions and use transactions where multiple records must remain synchronized.

The collector and publisher each receive a separate Playwright persistent profile protected by database-backed leases. Download and publish jobs use explicit claim states, retry timing, and stale-work recovery. Uncertain publication results require manual attention rather than blind retries.

The dashboard provides operator workflows through Next.js Server Actions. Dedicated workers expose the same services for one-off or recurring operation. SQLite and repository-local media are suitable for one trusted machine; they are not a distributed queue or storage system.

Review is split across a server-rendered queue and a client-side card/dialog interface. Caption, schedule, and lifecycle mutations remain Server Actions so repository and state validation stay authoritative. Manual compression creates a temporary FFmpeg candidate, validates its metadata and hashes, moves it into video storage, conditionally switches the `MediaAsset` record, and removes the old file only after that switch succeeds.

Scheduling treats `APP_TIMEZONE` as the canonical business timezone. The compact dashboard control opens a custom calendar with editable 24-hour hour and minute fields; the server converts that wall time through Temporal into an absolute instant and rejects invalid daylight-saving transitions. Unscheduled approved jobs remain manual-only, while automatic owners claim only due jobs with non-null schedules. Bulk approval validates all selected jobs in one database transaction.

The dashboard uses Tailwind utilities for Review, Overview, scheduling, modal, and responsive leaf layouts while preserving stable semantic classes on older pages. Shared semantic color variables provide consistent light and dark surfaces, text, accents, and state colors.

Configuration has two scopes. Base device bindings such as repository, media-tool, and storage paths remain in the ignored local environment file; dashboard-selected browser bindings are stored as non-portable device overrides. Portable dashboard preferences and managed source rules can be represented by a versioned manifest; imports pass a strict schema and never carry browser credentials, session-verification timestamps, media, or machine paths.

Browser configuration has a device-local database override layer. The dashboard detects common Windows Chromium installations, validates selected executables, and assigns independent collector and publisher profiles under `storage/browser-profiles/`. Playwright receives either a branded channel or an explicit executable path. Session verification is accepted only when its stored binding fingerprint matches the current role, executable, profile root, and internal profile. These device settings and verification records are not portable.

`BrowserIdentity` is the concurrency and account-ownership boundary. Sources, collected posts, download cookie selection, collection runs, and publication targets retain identity IDs. Physical profiles use identity-scoped renewable leases. Review approval may fan one item out into several Publisher jobs; each target owns its schedule, attempts, error state, claim token, and publication result.

See `packages/database/prisma/schema.prisma` for the authoritative data model and `docs/operations.md` for operational limitations.
