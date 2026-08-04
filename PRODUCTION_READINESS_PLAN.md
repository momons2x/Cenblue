# Cenblue Production Readiness Plan

## Objective

Prepare Cenblue for reliable unattended operation while preserving its current local-first workflow.

The work is divided into phases so correctness and operational safety are addressed before product expansion and scalability features such as multiple publisher accounts, additional social platforms, cloud storage, and PostgreSQL.

## Current Assessment

| Deployment target | Estimated readiness |
| --- | ---: |
| Supervised personal use | 65-70% |
| Unattended single-machine service | 45-55% |
| Internet-accessible deployment | 30-40% |
| Multi-user SaaS deployment | 20-30% |

## Target Product Direction

Cenblue should evolve from a single X-video repost pipeline into a durable publishing workspace where collected and original content share one review and scheduling system.

The target flow is:

```text
ContentItem
  -> ContentRevision
  -> ordered MediaAssets
  -> PublicationTargets by platform and publisher account
  -> independent attempts and external publications
```

Core principles:

- Collected posts remain provenance records rather than the canonical publication model.
- Original and collected content use the same Review, Queue, scheduling, retry, and Published workflows.
- One content revision may target several accounts and platforms without sharing execution state.
- Every generated caption and schedule is previewed and frozen before approval.
- Platform-specific metadata is owned by versioned publisher adapters rather than columns on the core job.
- Official APIs are preferred over browser automation whenever they are available and practical.
- Credentials, browser sessions, notification secrets, and signed URLs never enter portable settings or logs.
- Product expansion does not bypass the safety, authentication, queue, and database prerequisites in Phases 1-6.

## Phase 1: Immediate Safety Fixes

**Goal:** Eliminate behavior that could publish or process content unexpectedly.

- [ ] Make the automatic publisher require `PUBLISH_MODE=AUTOMATIC`.
- [ ] Add tests proving assisted mode cannot publish automatically.
- [ ] Choose one scheduler owner, preferably a dedicated pipeline process.
- [ ] Prevent the dashboard and pipeline from running competing publisher loops.
- [ ] Review stale-job recovery to prevent duplicate processing.
- [ ] Confirm all destructive actions require explicit confirmation.
- [ ] Ensure uncertain publication results always require manual review.

**Completion criteria:**

- Assisted mode never publishes automatically.
- Only one component owns recurring background scheduling.
- Crashed or stale publishing attempts cannot silently publish twice.

## Phase 2: Errors and Observability

**Goal:** Make failures understandable and manageable without inspecting raw terminal output.

- [ ] Define standard error categories and codes.
- [ ] Separate user-friendly messages from internal diagnostic details.
- [ ] Add an operation or correlation ID to jobs, logs, and UI errors.
- [ ] Replace silent dashboard loggers with the shared structured logger.
- [ ] Add worker heartbeat and last-success information.
- [ ] Add visible states such as `RETRYING`, `BLOCKED`, `SESSION_EXPIRED`, and `MANUAL_ATTENTION`.
- [ ] Add health and readiness endpoints.
- [ ] Report database, storage, browser, binary, and worker health.
- [ ] Stop placing raw internal error messages in redirect URLs.
- [ ] Add warnings for repeated failures.

**Completion criteria:**

- Every failed operation has a stable error code.
- UI messages can be connected to detailed logs.
- Operators can determine whether each worker is healthy.
- Sensitive paths and internal details are not exposed to users.

## Phase 3: Authentication and Security

**Goal:** Make the dashboard safe to expose beyond localhost.

- [ ] Add operator authentication and secure sessions.
- [ ] Protect all pages, APIs, media, diagnostics, and Server Actions.
- [ ] Add authorization checks inside every mutation.
- [ ] Require recent authentication for publishing, deletion, reset, and account changes.
- [ ] Add an audit log for sensitive operations.
- [ ] Add standard HTTP security headers.
- [ ] Restrict the dashboard listening interface by default.
- [ ] Review permissions for browser profiles, backups, logs, and diagnostics.
- [ ] Define retention rules for diagnostic screenshots and sensitive logs.
- [ ] Add rate limiting where appropriate.

**Completion criteria:**

- Anonymous users cannot read data or perform operations.
- Every sensitive action records who performed it and when.
- Browser sessions and diagnostics are not publicly accessible.

## Phase 4: Worker and Queue Reliability

**Goal:** Separate long-running operations from dashboard requests and make workers safe during crashes.

- [ ] Move collection, download, publishing, and metrics operations into durable queues.
- [ ] Make dashboard actions enqueue work instead of performing it directly.
- [ ] Add a claim owner and unique claim token to each running job.
- [ ] Require the claim token when completing or failing a job.
- [ ] Add renewable leases and worker heartbeats.
- [ ] Stop work if a worker loses its lease.
- [ ] Make stale thresholds configurable per operation.
- [ ] Add startup recovery for stale runs and jobs.
- [ ] Handle graceful shutdown and active operation cancellation.
- [ ] Test operations running longer than their original lease.
- [ ] Test crashes before and after external publication.

**Completion criteria:**

- Dashboard restarts do not cancel durable work.
- Expired workers cannot complete jobs claimed by another worker.
- Long-running valid operations retain their leases.
- Worker crashes result in retry or manual attention without silent corruption.

## Phase 5: Database Hardening

**Goal:** Strengthen current SQLite correctness before changing database providers.

- [ ] Replace unconstrained status strings with validated enums or constraints.
- [ ] Add missing duplicate-group relationships and foreign keys.
- [ ] Ensure a publish job cannot reference another post's media.
- [ ] Derive ownership fields from the claimed job instead of caller input.
- [ ] Change media file size from `Int` to `BigInt`.
- [ ] Add indexes for checksum and duplicate-detection queries.
- [ ] Review read-before-create operations for race conditions.
- [ ] Make inserts and scheduling explicitly idempotent.
- [ ] Automatically back up the database before migrations.
- [ ] Add backup retention and restore verification.
- [ ] Document failed migration and rollback procedures.

**Completion criteria:**

- Invalid job states are rejected.
- Relationships are enforced by the database.
- Concurrent workers cannot create inconsistent records.
- A tested database restore process exists.

## Phase 6: Release and Version Management

**Goal:** Make installations and upgrades reproducible.

- [ ] Add a Cenblue application version.
- [ ] Show the version in logs, the dashboard, and health responses.
- [x] Pin the supported Node.js version.
- [x] Replace dependency `latest` ranges with controlled versions.
- [x] Define a dependency update policy.
- [ ] Add production startup scripts for the dashboard and workers.
- [ ] Compile workers for production or include their runtime dependencies.
- [ ] Define migration-before-start behavior.
- [ ] Add a single-machine process supervisor configuration.
- [ ] Document installation, upgrade, rollback, and recovery procedures.

**Completion criteria:**

- Every running installation reports its exact version.
- Production installation does not accidentally depend on development packages.
- Upgrades consistently apply backups, migrations, builds, and health checks.
- A previous stable version can be restored.

## Phase 7: Durable Original Content and Neutral Publishing Model

**Goal:** Allow original and collected content to share one durable editorial workflow.

- [ ] Add a platform-neutral `ContentItem` model with `MANUAL` and `COLLECTED` origins.
- [ ] Add immutable or versioned `ContentRevision` records for approved text and metadata.
- [ ] Decouple media from `SourcePost` and support ordered reusable assets.
- [ ] Support text-only, image, image-gallery, and video content where target capabilities permit.
- [ ] Make video-only metadata nullable for non-video assets.
- [ ] Replace predictable source-post media lookup with immutable asset IDs.
- [ ] Convert Compose from immediate browser publishing into durable draft creation.
- [ ] Add Save draft, Send to Review, Approve, Publish now, and Schedule actions for original content.
- [ ] Replace buffered Server Action video uploads with streamed, quota-checked staging.
- [ ] Probe, checksum, validate, and recover staged uploads before they become publishable assets.
- [ ] Backfill existing collected posts into content items while retaining source attribution and duplicate information.
- [ ] Preserve existing X jobs and publication history through a tested additive migration.

**Completion criteria:**

- Original posts survive dashboard and worker restarts before publication.
- Original and collected content use the same review, queue, retry, schedule, and archive paths.
- A content revision cannot change after targets are approved without creating a new revision.
- Text, image, and video assets are validated and retained through a consistent storage contract.

## Phase 8: Multiple X Publisher Accounts

**Goal:** Support multiple publishing identities safely and independently.

- [ ] Add a `PublisherAccount` database model.
- [ ] Store platform identity, username, profile reference, and session status.
- [ ] Associate every publish job with a publisher account.
- [ ] Represent every selected account as an independent publication target.
- [ ] Use `(contentRevisionId, publisherAccountId)` uniqueness to prevent accidental duplicate targets.
- [ ] Give each account a separate browser profile and lease.
- [ ] Scope session verification and intervention state per account.
- [ ] Verify the active browser identity before publishing.
- [ ] Add per-account scheduling, timezone, rate limits, and enable/disable controls.
- [ ] Add account filters and status indicators to the dashboard.
- [ ] Include publisher-account identity in logs and audit events.
- [ ] Add a Review target matrix for selecting accounts and previewing each final caption and schedule.
- [ ] Support a shared caption, account-specific templates, manual overrides, and deterministic template variation.
- [ ] Add a pre-approval caption shuffle action that persists the selected result instead of rerolling at publish time.
- [ ] Support same-time, fixed-offset, staggered-window, and custom per-account schedules.
- [ ] Add account defaults for editorial voice, hashtag rules, attribution, posting windows, spacing, and daily limits.
- [ ] Freeze every generated caption and schedule when approved for predictable execution and auditability.
- [ ] Track retries, failures, manual attention, published IDs, and external URLs independently for each account.
- [ ] Add safeguards and operator guidance for repetitive content, unsafe rates, and platform spam policies.

**Completion criteria:**

- Jobs cannot publish through the wrong account.
- One account's expired session does not block unrelated accounts.
- Browser profiles cannot be opened concurrently.
- Every publication can be traced to its publisher account.

## Phase 9: Operational Events and Notifications

**Goal:** Deliver useful Telegram and Discord alerts without making external messaging part of job correctness.

- [ ] Define stable error codes, sanitized operator messages, severity, fingerprints, and correlation IDs.
- [ ] Add durable `OperationalEvent`, `NotificationChannel`, and `NotificationOutbox` models.
- [ ] Insert operational events transactionally with authoritative job state changes where possible.
- [ ] Add a claim-token-fenced notification dispatcher with stale-claim recovery.
- [ ] Implement Telegram Bot API delivery with chat validation and `retry_after` handling.
- [ ] Implement Discord webhooks as the first Discord transport.
- [ ] Consider a Discord bot only for commands, acknowledgements, or interactive incident management.
- [ ] Add minimum severity, component/category filters, quiet hours, and critical-alert bypass.
- [ ] Deduplicate repeated incidents and aggregate retry storms within a configurable window.
- [ ] Notify terminal failures, uncertain publications, session expiry, storage corruption, and worker outages by default.
- [ ] Suppress ordinary transient retries unless the operator explicitly enables them.
- [ ] Support optional recovery notifications when incidents resolve.
- [ ] Add exponential delivery retries with jitter, provider rate-limit handling, and dead-letter state.
- [ ] Add Settings flows for Connect, Replace secret, Test notification, Disable, and Remove.
- [ ] Show last success, sanitized failure, next retry, queue depth, and delivery history.
- [ ] Store tokens and webhook URLs in an OS-backed or encrypted secret store with environment fallback.
- [ ] Exclude notification secrets and sensitive destinations from portable exports, logs, backups where possible, and UI responses.
- [ ] Never attach browser diagnostics, captions, source text, cookies, tokens, stack traces, or profile paths automatically.

**Completion criteria:**

- Publishing and collection remain correct when every notification provider is unavailable.
- Repeated failures do not create uncontrolled message storms.
- Telegram and Discord test messages traverse the same durable outbox as real incidents.
- No notification credential appears in logs, portable exports, browser responses, or event payloads.

## Phase 10: Multi-Platform Publisher Foundation

**Goal:** Publish one approved content revision through account-scoped, capability-aware adapters.

- [ ] Add platform and verified external identity to `PublisherAccount`.
- [ ] Add `PublicationTarget`, `ExternalPublication`, and `PublishAttempt` records.
- [ ] Store explicit dispatch mode (`MANUAL` or `SCHEDULED`) rather than inferring it only from a null date.
- [ ] Add a publisher-adapter registry with capabilities, validation, publish, identity verification, and reconciliation contracts.
- [ ] Resolve the selected account and adapter after claiming a target.
- [ ] Add account-scoped token refresh locks, leases, rate limits, and concurrency controls.
- [ ] Support canonical content plus versioned provider-owned metadata payloads.
- [ ] Add target-specific caption, title, description, audience, thumbnail, and media validation.
- [ ] Add remote processing and reconciliation states for providers that finish work asynchronously.
- [ ] Scope external publication IDs by platform and publisher account.
- [ ] Add platform/account filters and grouped content views to Review, Queue, Published, Overview, and Logs.
- [ ] Derive content-level summaries from target states instead of marking the whole item published after one target succeeds.
- [ ] Add account connection, capability, scope, token-expiry, intervention, and revocation UI.
- [ ] Require authentication, authorization, recent reauthentication, and audit records for account and publication changes.
- [ ] Store OAuth refresh tokens through encrypted or OS-backed secret references rather than `AppSetting`.

**Completion criteria:**

- One content revision can publish to several accounts and platforms independently.
- One failed target does not corrupt or block successful unrelated targets.
- Provider-specific requirements do not leak into the core publication schema.
- Uncertain remote results are reconciled before any retry can create a duplicate.

## Phase 11: Platform Rollout

**Goal:** Add platforms incrementally through official APIs and explicit capability limits.

### YouTube

- [ ] Add OAuth channel connection and verified channel identity.
- [ ] Implement resumable video upload, title, description, category, tags, privacy, and thumbnail metadata.
- [ ] Support scheduled release where current API rules permit it.
- [ ] Persist remote processing state and poll until the upload is usable or fails.
- [ ] Track quota errors and account-level upload limits.
- [ ] Do not promise generic text/image Community post publishing without supported API capability.

### Facebook

- [ ] Add Meta authorization and Facebook Page discovery.
- [ ] Support Page text, photo, video, and Reel targets according to current Graph API capabilities.
- [ ] Track Page permissions, token lifetime, role changes, and app-review requirements.
- [ ] Do not present personal-profile publishing as a supported target.

### Instagram

- [ ] Add eligible Business or Creator account discovery and verification.
- [ ] Support images, Reels/video, and carousels according to current publishing limits.
- [ ] Validate media aspect ratio, codec, duration, size, and container-processing state.
- [ ] Add temporary signed object delivery when Meta requires remotely reachable media.
- [ ] Do not present personal accounts or text-only feed posts as supported targets.

### X API

- [ ] Evaluate current official API access, media upload capability, quotas, pricing, and policy requirements.
- [ ] Add an OAuth/API adapter when access is practical.
- [ ] Keep Playwright publishing as an explicitly labeled fallback rather than the platform-neutral default.

**Completion criteria:**

- Every enabled platform has adapter contract tests and documented live smoke procedures.
- Unsupported content types are rejected before approval.
- Provider quotas, permissions, processing, and account intervention are visible to operators.
- Current platform terms and permissions are reviewed before each adapter is enabled in production.

## Phase 12: Storage Abstraction

**Goal:** Remove direct filesystem assumptions before introducing cloud storage.

- [ ] Add a provider-neutral `StorageObject` model.
- [ ] Store object keys and metadata instead of absolute paths.
- [ ] Introduce a storage interface for upload, read, verify, stream, and delete.
- [ ] Implement a local-filesystem adapter first.
- [ ] Migrate existing media paths to local storage-object records.
- [ ] Update media serving, publishing, auditing, deletion, and cleanup.
- [ ] Add asynchronous and retryable deletion jobs.
- [ ] Add database-to-storage reconciliation.
- [ ] Materialize cloud objects to temporary local files for Playwright publishing.
- [ ] Ensure temporary publisher files are securely cleaned.

**Completion criteria:**

- Business logic no longer directly depends on filesystem paths.
- Existing local storage continues working through the abstraction.
- Interrupted upload and deletion operations can be recovered safely.

## Phase 13: Cloud Object Storage

**Goal:** Support scalable and durable media storage when local disk is no longer sufficient.

- [ ] Select an S3-compatible storage provider.
- [ ] Implement the cloud storage adapter.
- [ ] Add multipart upload for large media.
- [ ] Verify uploaded size and checksum.
- [ ] Use signed URLs or authenticated streaming for dashboard playback.
- [ ] Configure object versioning and lifecycle rules.
- [ ] Add orphaned-object and missing-object reconciliation.
- [ ] Define media retention and deletion policies.
- [ ] Add storage capacity, failure, and cost monitoring.
- [ ] Test interrupted upload, duplicate upload, and partial deletion.

**Completion criteria:**

- Media survives application-host replacement.
- Dashboard and workers can run on separate machines.
- Database records and cloud objects are regularly reconciled.
- Cloud storage failures do not silently lose media.

## Phase 14: PostgreSQL Migration

**Goal:** Adopt a server database when workload or deployment architecture requires it.

PostgreSQL should be introduced when Cenblue needs multiple application hosts, higher worker concurrency, remote hosting, or multi-user operation.

- [ ] Create a clean PostgreSQL schema baseline.
- [ ] Do not replay SQLite-specific migrations directly.
- [ ] Replace queue claiming with PostgreSQL-safe atomic claims or `SKIP LOCKED`.
- [ ] Use database time for lease acquisition and renewal.
- [ ] Add connection pooling and transaction timeouts.
- [ ] Extend retry handling for deadlocks and serialization failures.
- [ ] Build a resumable SQLite-to-PostgreSQL migration tool.
- [ ] Validate row counts, relationships, and media checksums.
- [ ] Rehearse migration and rollback before production cutover.
- [ ] Configure automated backups and point-in-time recovery.
- [ ] Perform periodic restore drills.

**Completion criteria:**

- Migration can be rehearsed and repeated safely.
- Queue behavior is tested under concurrent PostgreSQL workers.
- Automated backups and point-in-time recovery are active.
- SQLite remains available for rollback during the agreed transition period.

## Phase 15: CI/CD and Operations

**Goal:** Prevent untested or unrecoverable releases.

- [x] Add automated lint, type checking, tests, and production builds.
- [x] Ensure dashboard TypeScript and TSX files are linted.
- [x] Add migration validation.
- [ ] Add route, authentication, and authorization tests.
- [x] Add dependency and secret scanning.
- [x] Add production smoke tests.
- [ ] Add post-deployment health checks.
- [ ] Add automated backup monitoring.
- [ ] Define deployment rollback conditions.
- [ ] Add disk, database, queue, worker, and publishing alerts.
- [ ] Document incident-response and recovery procedures.

**Completion criteria:**

- Failed checks prevent deployment.
- Every deployment receives a version and health verification.
- Backup failures and unhealthy workers generate alerts.
- Recovery procedures have been tested rather than only documented.

## Recommended Milestones

### Milestone 1: Safe Local Operation

Complete Phases 1, 2, 4, and essential database fixes from Phase 5.

**Expected result:** Reliable unattended use on one trusted computer.

### Milestone 2: Controlled Production Operation

Complete Phases 3, 6, and 15.

**Expected result:** Reproducible releases and safe access through a private network or authenticated reverse proxy.

### Milestone 3: Durable Original Publishing

Complete Phase 7.

**Expected result:** Original and collected content share a durable draft, review, schedule, queue, and publication workflow.

### Milestone 4: Multiple X Publisher Accounts

Complete Phase 8.

**Expected result:** Independent X identities with account-specific captions, schedules, profiles, jobs, and publication results.

### Milestone 5: Actionable Notifications

Complete Phase 9.

**Expected result:** Deduplicated Telegram and Discord alerts for terminal failures, uncertain publications, and unhealthy workers.

### Milestone 6: Multi-Platform Foundation

Complete Phase 10 and the shared prerequisites from Phases 3-5.

**Expected result:** Platform-neutral, account-scoped publication targets with provider validation and reconciliation.

### Milestone 7: Platform Expansion

Complete the required adapters from Phase 11, starting with YouTube and then eligible Meta accounts.

**Expected result:** Supported content can be published independently to X, YouTube, Facebook Pages, and Instagram professional accounts.

### Milestone 8: Cloud-Ready Architecture

Complete Phases 12 and 13.

**Expected result:** Provider-neutral media handling and optional cloud object storage.

### Milestone 9: Distributed Deployment

Complete Phase 14 and the remaining operational work.

**Expected result:** PostgreSQL-backed operation across multiple application or worker hosts.

## Guiding Priorities

1. Prevent incorrect or unauthorized publishing.
2. Make failures visible and recoverable.
3. Separate long-running work from dashboard requests.
4. Strengthen database ownership and concurrency guarantees.
5. Make releases reproducible.
6. Unify original and collected content before adding destination fan-out.
7. Add multiple X accounts with frozen editorial variations and independent jobs.
8. Deliver notifications from durable operational events rather than log scraping.
9. Add platform adapters incrementally through official APIs and explicit capabilities.
10. Abstract storage before adopting cloud storage.
11. Move to PostgreSQL only when the deployment model requires it.
