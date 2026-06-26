# Shield Assurance CRM Instructions

- Use pnpm workspaces and keep app boundaries clear: web in apps/web, API in apps/api, worker in apps/worker, shared contracts in packages/shared.
- Preserve strict TypeScript settings and avoid any `any` types unless absolutely required.
- Keep backend architecture modular and testable (feature modules, thin controllers, service orchestration).
- Favor optimistic UX in the web app and resilient async processing in the worker.
- Keep external integrations behind adapter services (Twilio, SendGrid, Microsoft Graph).
