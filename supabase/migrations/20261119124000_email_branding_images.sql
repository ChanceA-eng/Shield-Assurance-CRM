begin;

-- Email clients need a stable, unauthenticated URL. Only store public branding here.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('email-branding-images','email-branding-images',true,4194304,array['image/jpeg']);

create policy email_branding_service_only on storage.objects as restrictive
for all to anon,authenticated
using(bucket_id<>'email-branding-images') with check(bucket_id<>'email-branding-images');

commit;
