# Vercel Deployment Checklist

Rashi is deployment-ready through the Next.js web app.

## What Runs On Vercel

- The root [vercel.json](c:\Users\chanc\Shield Assurance CRM\vercel.json) builds the web app only.
- Rashi ingest, query, stats, and document reads now run from the Node routes under `apps/web/src/app/api/rashi`.
- The separate Nest API and BullMQ worker remain useful for local and non-Vercel deployments, but they are no longer required for the web deployment to serve Rashi.

## Required Environment Variables

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `RASHI_EMBEDDING_MODEL` optional, defaults to `text-embedding-3-small`
- `RASHI_CHAT_MODEL` optional, defaults to `gpt-4o-mini`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Database Requirements

- Apply `supabase/migrations` and the Prisma migrations before deployment.
- The web build runs `schema:verify` before `next build`. Vercel will reject a deployment when required Supabase columns or functions are missing; apply migrations, then redeploy.
- Ensure the target PostgreSQL instance has the `vector` extension enabled.
- Ensure the target database includes the Rashi migrations in `apps/api/prisma/migrations`.

## Build Notes

- The web app depends on `@prisma/client` and `pdf-parse` at build/runtime.
- The root install already runs Prisma client generation through the workspace postinstall step.
- For production uploads, keep PDF sizes modest enough for serverless request limits or move large file storage/extraction to object storage plus background jobs.