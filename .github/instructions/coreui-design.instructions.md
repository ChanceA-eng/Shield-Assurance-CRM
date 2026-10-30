---
description: "Use when: implementing UI, navigation, dashboard, or page layout work in the Shield Assurance CRM web app."
applyTo: "apps/web/src/**"
---

# Shield Assurance CRM Design Direction

EzLynx parity is retired as a design goal. The product direction is a CoreUI-style admin interface built natively in Tailwind. Do not reintroduce the icon-rail/flyout navigation model.

## Visual system

- Palette lives in `apps/web/tailwind.config.ts` under the `cui` namespace: primary `#20a8d8`, success `#4dbd74`, warning `#ffc107`, danger `#f86c6b`, dark sidebar `#2f353a`, body background `#e4e5e6`.
- Do not install `@coreui/react` or Bootstrap CSS; recreate the look with Tailwind utilities and the shared components below.

## App shell

- `src/components/layout/AppShell.tsx` composes the frame: full-width white `AppHeader` on top, dark expanded `AppSidebar` on the left, scrollable main content on `bg-cui-body`. The shell is skipped on `/login`.
- `AppSidebar` renders groups from `src/config/navigation.ts` (single source of truth). Keep navigation entries deduplicated — never point multiple sidebar links at the same stub page.
- `AppHeader` owns the brand, sidebar toggle (via `NavContext`), pathname breadcrumbs, the notification bell (`NotificationContext`), and the user menu with Supabase sign-out.

## Pages

- Wrap standard pages in `src/components/crm/SectionLayout.tsx` (page title header + padded content). It must never render its own sidebar.
- Use `src/components/ui/Card.tsx` (Card/CardHeader/CardBody) for content panels and `src/components/ui/StatWidget.tsx` for colored KPI widgets.
- Dashboards and widgets must be wired to real API data (for example `/api/metrics/home`, `/api/recent`, `/api/tasks`, `/api/renewals`). Never ship hardcoded placeholder metrics or fake activity entries.
- Charts use `recharts` with the `cui` palette.

## Data and auth wiring

- Page data flows through Next.js route handlers in `src/app/api/**` backed by Supabase (`getSupabaseServerClient`).
- `src/middleware.ts` protects all routes; externally-called endpoints (crons, webhooks, public website lead POST) must be added to its explicit public allowlist and enforce their own authorization.
