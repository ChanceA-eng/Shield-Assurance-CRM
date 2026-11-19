begin;

create table if not exists public.carrier_appetite_ai_readings (
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  reader_version text not null,
  state text not null check(state in ('processing','complete','failed')),
  reading jsonb,
  updated_at timestamptz not null default now(),
  primary key(source_hash,reader_version),
  check(state <> 'complete' or jsonb_typeof(reading) = 'object')
);
alter table public.carrier_appetite_ai_readings enable row level security;
revoke all on public.carrier_appetite_ai_readings from public,anon,authenticated,service_role;
grant select,insert,update on public.carrier_appetite_ai_readings to service_role;

create or replace function public.apply_carrier_appetite_reading(p_actor uuid,p_id uuid,p_expected integer,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare original carrier_appetite_documents; saved jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('carrier-appetite:'||p_id::text));
  select * into original from carrier_appetite_documents where id=p_id;
  if original.id is null or original.revision<>p_expected or original.revision=0 then
    raise exception 'Guide changed. Reopen it before reading with AI.' using errcode='PT409';
  end if;
  saved:=save_carrier_appetite(p_actor,p_id,p_expected,'save',jsonb_build_object('pages',original.pages,'values',p_values));
  if original.state='active' then
    saved:=save_carrier_appetite(p_actor,p_id,(saved->>'revision')::integer,'activate','{}'::jsonb);
  end if;
  return saved;
end;
$$;
revoke all on function public.apply_carrier_appetite_reading(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.apply_carrier_appetite_reading(uuid,uuid,integer,jsonb) to service_role;

create or replace function public.carrier_appetite_source_overlaps()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(d.id),'[]'::jsonb) from carrier_appetite_documents d
  where d.state='active' and exists(
    select 1 from carrier_appetite_documents other
    where other.state='active' and other.id<>d.id
      and lower(trim(other.values->>'carrier'))=lower(trim(d.values->>'carrier'))
      and (
        nullif(trim(d.values->>'line'),'') is null or nullif(trim(other.values->>'line'),'') is null
        or exists (
          select 1
          from regexp_split_to_table(lower(d.values->>'line'), '[,;\n]') a,
            regexp_split_to_table(lower(other.values->>'line'), '[,;\n]') b
          where
            case trim(a) when 'auto' then 'commercial auto' when 'business auto' then 'commercial auto'
              when 'fleet' then 'commercial auto' when 'commercial automobile' then 'commercial auto'
              when 'property' then 'commercial property' when 'gl' then 'general liability'
              when 'wc' then 'workers compensation' when 'workers comp' then 'workers compensation' else trim(a) end
            =
            case trim(b) when 'auto' then 'commercial auto' when 'business auto' then 'commercial auto'
              when 'fleet' then 'commercial auto' when 'commercial automobile' then 'commercial auto'
              when 'property' then 'commercial property' when 'gl' then 'general liability'
              when 'wc' then 'workers compensation' when 'workers comp' then 'workers compensation' else trim(b) end
        )
      )
      and (
        nullif(trim(d.values->>'states'),'') is null or nullif(trim(other.values->>'states'),'') is null
        or exists (
          select 1 from regexp_split_to_table(upper(d.values->>'states'), '[,;\n]') a,
            regexp_split_to_table(upper(other.values->>'states'), '[,;\n]') b
          where trim(a)=trim(b) or trim(a)='ALL' or trim(b)='ALL'
        )
      )
  );
$$;
commit;
