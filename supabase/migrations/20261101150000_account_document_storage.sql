-- Private account document storage (Phase 1: reliable documents).
-- Safe to run without the Supabase storage schema (e.g. isolated Postgres/PGlite validation):
-- the bucket step is skipped when storage.buckets does not exist.

-- 1. Private bucket for account documents. No storage.objects policies are created on purpose:
--    only the server (service role) issues signed upload URLs and streams downloads.
do $$
declare
  has_size_limit boolean;
  has_mime_types boolean;
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets not found; skipping account-documents bucket creation';
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) into has_size_limit;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) into has_mime_types;

  execute 'insert into storage.buckets (id, name, public) values ($1, $1, false)
           on conflict (id) do update set public = false'
    using 'account-documents';

  if has_size_limit then
    execute 'update storage.buckets set file_size_limit = 26214400 where id = $1' using 'account-documents';
  end if;

  if has_mime_types then
    execute 'update storage.buckets set allowed_mime_types = $2 where id = $1'
      using 'account-documents', array[
        'application/pdf',
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/tiff',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv', 'text/plain'
      ]::text[];
  end if;
end
$$;

-- 2. Document record lookups by storage kind and one record per stored object.
create index if not exists idx_client_files_source_kind
  on public.client_files ((metadata->>'source_kind'));

create unique index if not exists uq_client_files_storage_path
  on public.client_files ((metadata->'storage'->>'path'))
  where metadata->'storage'->>'path' is not null;

-- 3. Legacy "uploads" that only saved a local-upload:// placeholder never stored any bytes.
--    Keep the rows (names may still be useful) but stop presenting them as uploaded files.
update public.client_files
set
  status = 'not_uploaded',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'source_kind', 'legacy_placeholder',
    'legacy_placeholder_url', file_url,
    'legacy_note', 'File bytes were never uploaded; re-upload the document to store it.'
  )
where file_url like 'local-upload://%'
  and coalesce(metadata->>'source_kind', '') <> 'legacy_placeholder';
