begin;
do $test$
declare a uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); q uuid:=gen_random_uuid();
begin
  insert into clients(id,full_name) values(a,'Quote fixture');
  insert into leads(id,full_name,account_id,status) values(l,'Quote fixture lead',a,'quoted');
  insert into quote_options(id,client_id,lead_id,source_lead_id,carrier,line_of_business,premium,created_by,updated_by)
    values(q,a,l,l,'Manual carrier','Auto',1234.56,'QA','QA');
  update quote_options set status='accepted',updated_by='Other QA' where id=q;
  if (select count(*) from quote_option_history where quote_id=q)<>2 then raise exception 'Quote history missing'; end if;
  if (select status from leads where id=l)<>'quoted' or exists(select 1 from policies where client_id=a) then
    raise exception 'Accepting quote established coverage or completed lead'; end if;
  begin
    update quote_options set effective_date='2026-11-02',expiration_date='2026-11-01' where id=q;
    raise exception 'Invalid term accepted';
  exception when check_violation then null; end;
  if has_table_privilege('anon','public.quote_options','SELECT') or has_table_privilege('authenticated','public.quote_options','INSERT') then
    raise exception 'Quote mutations or anonymous reads exposed'; end if;
end;
$test$;
rollback;
