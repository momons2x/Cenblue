# Security Policy

## Supported Versions

Cenblue is pre-1.0 software. Security fixes target the current `main` branch.

## Reporting

Use GitHub private vulnerability reporting for [momons2x/Cenblue](https://github.com/momons2x/Cenblue/security). Do not open a public issue for an unpatched vulnerability.

Never attach credentials, cookies, browser profiles, `.env`, databases, logs, diagnostic screenshots, account-private data, or downloaded media. Provide sanitized reproduction steps and affected commit information.

## Deployment Boundary

The dashboard currently has no authentication or authorization. It is intended for one trusted local operator. Do not expose it to the Internet or an untrusted network.

Treat `storage/`, browser user-data roots, backups, and diagnostics as sensitive. A browser-session compromise should also be handled directly through X account security controls.
