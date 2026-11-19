begin;

-- Preserve upload, revision, source-evidence and owner checks; only relax guide activation.
do $migration$
declare
  definition text;
  previous text := $previous$    if saved.state<>'draft' or saved.revision=0 or coalesce(jsonb_array_length(saved.values->'rules'),0)=0
      or nullif(saved.values->>'effective_on','') is null or nullif(saved.values->>'line','') is null
      or nullif(saved.values->>'states','') is null
      or exists(select 1 from jsonb_array_elements(saved.values->'rules') r where r->>'decision'='needs_review') then
      raise exception 'Review all rules, line, territory and effective date before activation' using errcode='22023'; end if;$previous$;
  replacement text := $replacement$    if saved.state<>'draft' or saved.revision=0 or not exists(
      select 1 from jsonb_array_elements(saved.pages) page where length(trim(page->>'text'))>0
    ) then
      raise exception 'Save a readable carrier guide before using it' using errcode='22023'; end if;$replacement$;
begin
  select pg_get_functiondef('public.save_carrier_appetite(uuid,uuid,integer,text,jsonb)'::regprocedure) into definition;
  if strpos(definition,previous)=0 then
    raise exception 'Carrier guide activation changed; inspect the installed function before applying this migration';
  end if;
  execute replace(definition,previous,replacement);
end;
$migration$;

commit;
