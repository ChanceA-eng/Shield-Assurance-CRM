# Shield Assurance CRM

Enterprise CRM foundation for insurance agencies combining:
- Salesforce-style relational rigor (PostgreSQL + Prisma)
- HubSpot-style asynchronous automation (BullMQ + Redis)
- Microsoft 365 integration surface (MSAL + Graph webhook and SharePoint stubs)

## Architecture

- `apps/web`: Next.js frontend with premium dashboard UX (kanban + command center + live feed)
- `apps/api`: NestJS API + Prisma + workflow enqueue logic
- `apps/worker`: BullMQ worker for `deal.bound` automation chains
- `packages/shared`: shared events and contracts
- `infra/docker-compose.yml`: local Postgres and Redis

## Quick Start

1. Install dependencies

```bash
pnpm install
```

2. Configure environment

```bash
cp .env.example .env
```

3. Start infrastructure

```bash
pnpm compose:up
```

4. Generate Prisma client and run migration

```bash
pnpm db:generate
pnpm db:migrate
```

5. Start all services

```bash
corepack pnpm dev
```

Web runs on `http://localhost:3000` and API on `http://localhost:4000`.

If you usually run `npm run dev`, the workspace-native alternative is:

```bash
corepack pnpm dev
```

## Workflow Engine

When a deal moves to `BOUND`, API endpoint `PATCH /deals/stage` enqueues `deal.bound` on Redis queue `insurance-workflows`.
Worker flow:
1. Load deal, account, and primary contact.
2. Send SMS (Twilio adapter placeholder).
3. Send email (SendGrid adapter placeholder).
4. Log `SYSTEM_NOTE` activity in PostgreSQL.

Jobs use retries with exponential backoff.

## Microsoft 365 Integration Stubs

- `MsalAuthService`: placeholder auth URL and token exchange hooks.
- `GraphWebhookController`: webhook endpoint/validation handling.
- `SharePointFolderService`: placeholder account folder provisioning.

## Security and Realtime

- Header-based API key guard (`x-api-key`) for protected endpoints.
- Role checks via `x-user-role` (`ADMIN`, `MANAGER`, `AGENT`).
- Socket.IO gateway broadcasts `activity:new` events for the live feed.

## Tests and CI

- Workspace tests use Vitest (`corepack pnpm -r test`).
- GitHub Actions CI validates install, typecheck, and tests on push/PR.

## High-End UI Features

- Optimistic kanban card transitions with rollback on API failure.
- Global command center on `Cmd/Ctrl + K`.
- Real-time activity feed with Socket.IO client hook.

## Production Hardening Next

1. Add authentication/authorization (Azure AD RBAC + JWT session model).
2. Add request/response DTO validation for every endpoint.
3. Add test suites (unit + integration + e2e).
4. Replace integration stubs with real Twilio, SendGrid, and Graph SDK adapters.
5. Add observability (OpenTelemetry, structured logs, and alerting).
