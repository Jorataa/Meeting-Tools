-- Run against a disposable local Supabase database AFTER schema.sql.
-- psql -v ON_ERROR_STOP=1 -f supabase/security-tests.sql
-- Transaction rolls back fixture accounts and meetings.
begin;
insert into auth.users(id,email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','security-owner-a@example.invalid'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','security-owner-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}',true);
insert into public.hush_meetings(id,user_id,title,started_at,document) values
 ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Private A',now(),'{"transcript":"Private A"}');
do $$begin
 begin
  insert into public.hush_meetings(id,user_id,title,started_at,document) values('bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Forged owner',now(),'{}');
  raise exception 'SECURITY FAILURE: forged owner insert succeeded';
 exception when insufficient_privilege then null; end;
 begin
  update public.hush_meetings set user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id='aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';
  raise exception 'SECURITY FAILURE: owner transfer succeeded';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","is_anonymous":false}',true);
do $$declare affected integer;begin
 if exists(select 1 from public.hush_meetings where id='aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa') then raise exception 'SECURITY FAILURE: cross-user read';end if;
 update public.hush_meetings set title='Hijacked' where id='aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';get diagnostics affected=row_count;
 if affected<>0 then raise exception 'SECURITY FAILURE: cross-user update';end if;
 delete from public.hush_meetings where id='aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';get diagnostics affected=row_count;
 if affected<>0 then raise exception 'SECURITY FAILURE: cross-user delete';end if;
end $$;
do $$begin
 if not public.hush_consume_ai_quota('diagnostic') or not public.hush_consume_ai_quota('diagnostic') or not public.hush_consume_ai_quota('diagnostic') then raise exception 'Quota rejected normal requests';end if;
 if public.hush_consume_ai_quota('diagnostic') then raise exception 'SECURITY FAILURE: shared quota bypass';end if;
 begin perform public.hush_consume_ai_quota('unlimited');raise exception 'SECURITY FAILURE: arbitrary quota scope';exception when invalid_parameter_value then null;end;
 begin delete from hush_private.ai_limits;raise exception 'SECURITY FAILURE: quota reset';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
