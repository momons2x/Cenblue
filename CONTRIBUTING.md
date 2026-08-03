# Contributing

Contributions are welcome through [GitHub](https://github.com/momons2x/Cenblue).

## Setup

Use Node.js 22.12 or newer and pnpm 10.12.1. Follow the README with a dedicated test `.env`. Never use a production database or real browser profile for automated tests.

## Checks

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before opening a pull request. Run the relevant smoke command when changing workers, routes, storage, or publishing.

## Safety Rules

- Never commit `.env`, databases, browser profiles, cookies, logs, diagnostics, downloaded media, or backups.
- Use synthetic fixtures only.
- Add a Prisma migration for schema changes and describe recovery implications.
- Add tests for job transitions, publication safety, destructive operations, and concurrency changes.
- Do not weaken confirmation, lease, path-containment, or uncertain-publication safeguards.
- Document behavior and operational changes.

Pull requests should be focused and explain testing, database impact, publishing risk, and rollback behavior.
