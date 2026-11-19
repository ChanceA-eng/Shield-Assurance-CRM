begin;
do $test$
declare a uuid:=gen_random_uuid(); before_summary jsonb; summary jsonb; shell jsonb; expected numeric;
begin
  before_summary:=home_premium_summary('2025-12-01');
  insert into clients(id,full_name) values(a,'Loading performance QA');
  insert into policies(client_id,account_id,insured_name,carrier,line_of_business,premium,policy_number,effective_date,expiration_date,status)
    select a,a,'Loading QA','QA carrier','Auto',100.25,'LOADING-QA-'||n,'2026-11-01'::date,'2027-11-01'::date,'issued'
    from generate_series(1,1501) n;
  summary:=home_premium_summary('2025-12-01');
  if (summary->>'total')::numeric-(before_summary->>'total')::numeric<>150475.25 then raise exception 'Premium aggregation lost records'; end if;
  if jsonb_array_length(summary->'months')<>12 or summary#>>'{months,11,month}'<>'2026-11' then raise exception 'Invalid month series'; end if;
  select coalesce(sum(premium),0) into expected from policies where effective_date>='2026-11-01' and effective_date<'2026-12-01';
  if (summary#>>'{months,11,premium}')::numeric<>expected then raise exception 'Chart premium differs from full dataset'; end if;
  shell:=crm_shell_summary();
  if (shell->>'overdueCount')::bigint<>(select count(*) from tasks where status='open' and due_date<now()) then raise exception 'Overdue count changed'; end if;
  if (shell->>'dueTodayCount')::bigint<>(select count(*) from tasks where status='open' and due_date<
    (date_trunc('day',now() at time zone 'America/Phoenix')+interval '1 day') at time zone 'America/Phoenix') then raise exception 'Arizona due count changed'; end if;
  if (shell->>'unreadCount')::bigint<>(select count(*) from notifications where read=false) then raise exception 'Unread count changed'; end if;
  if jsonb_array_length(shell->'notifications')<>least(100,(select count(*) from notifications)) then raise exception 'Notification feed incomplete'; end if;
  if shell->'unreadMessages' is distinct from unread_message_summary() then raise exception 'Message badges changed'; end if;
  if has_function_privilege('authenticated','public.crm_shell_summary()','EXECUTE')
    or has_function_privilege('anon','public.home_premium_summary(date)','EXECUTE') then raise exception 'Summary exposed without authorization'; end if;
end;
$test$;
rollback;
