-- Prepared baseline. Apply only to the confirmed project after reviewing its
-- existing schema. Audio is not retained in Supabase Storage by this product.
begin;

create table if not exists public.hush_meetings (
 id uuid primary key,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null check (char_length(title) between 1 and 200),
 started_at timestamptz not null,
 ended_at timestamptz,
 duration integer not null default 0 check (duration >= 0),
 document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 2000000),
 updated_at timestamptz not null default now()
);
create index if not exists hush_meetings_owner_started on public.hush_meetings (user_id, started_at desc);
alter table public.hush_meetings enable row level security;
alter table public.hush_meetings force row level security;
revoke all on public.hush_meetings from anon, public;
grant select, insert, update, delete on public.hush_meetings to authenticated;
drop policy if exists hush_meetings_select_own on public.hush_meetings;
drop policy if exists hush_meetings_insert_own on public.hush_meetings;
drop policy if exists hush_meetings_update_own on public.hush_meetings;
drop policy if exists hush_meetings_delete_own on public.hush_meetings;
create policy hush_meetings_select_own on public.hush_meetings for select to authenticated using ((select auth.uid()) = user_id);
create policy hush_meetings_insert_own on public.hush_meetings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy hush_meetings_update_own on public.hush_meetings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy hush_meetings_delete_own on public.hush_meetings for delete to authenticated using ((select auth.uid()) = user_id);
drop policy if exists hush_meetings_owner_boundary on public.hush_meetings;
create policy hush_meetings_owner_boundary on public.hush_meetings as restrictive for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Preferences cannot be reassigned to another account, including on upsert.
create table if not exists public.hush_preferences (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 10000),
 updated_at timestamptz not null default now()
);
alter table public.hush_preferences enable row level security;
alter table public.hush_preferences force row level security;
revoke all on public.hush_preferences from anon, public;
grant select, insert, update, delete on public.hush_preferences to authenticated;
drop policy if exists hush_preferences_select_own on public.hush_preferences;
drop policy if exists hush_preferences_insert_own on public.hush_preferences;
drop policy if exists hush_preferences_update_own on public.hush_preferences;
drop policy if exists hush_preferences_delete_own on public.hush_preferences;
create policy hush_preferences_select_own on public.hush_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy hush_preferences_insert_own on public.hush_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy hush_preferences_update_own on public.hush_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy hush_preferences_delete_own on public.hush_preferences for delete to authenticated using ((select auth.uid()) = user_id);
drop policy if exists hush_preferences_owner_boundary on public.hush_preferences;
create policy hush_preferences_owner_boundary on public.hush_preferences as restrictive for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Clients must not edit/reset their quota. A narrow fixed-scope function is the
-- only entry point. SECURITY DEFINER is required only for this private ledger,
-- never for meeting access; identity comes from the verified database JWT.
create schema if not exists hush_private;
revoke all on schema hush_private from public, anon, authenticated;
create table if not exists hush_private.ai_limits (
 user_id uuid not null references auth.users(id) on delete cascade,
 scope text not null,
 period_seconds integer not null,
 window_start timestamptz not null,
 count integer not null check(count > 0),
 primary key(user_id,scope,period_seconds)
);
alter table hush_private.ai_limits enable row level security;
revoke all on hush_private.ai_limits from public, anon, authenticated;

create or replace function public.hush_consume_ai_quota(requested_scope text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
 owner_id uuid := auth.uid();
 minute_limit integer;
 hour_limit integer;
 period_seconds integer;
 period_limit integer;
 current_count integer;
 allowed boolean := true;
 boundary timestamptz;
begin
 if owner_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
  raise exception 'Authentication required' using errcode = '42501';
 end if;
 case requested_scope
  when 'transcribe' then minute_limit:=6; hour_limit:=40;
  when 'interruption' then minute_limit:=12; hour_limit:=400;
  when 'ask' then minute_limit:=6; hour_limit:=80;
  when 'voice' then minute_limit:=30; hour_limit:=400;
  when 'ai' then minute_limit:=20; hour_limit:=300;
  when 'process' then minute_limit:=8; hour_limit:=350;
  when 'diagnostic' then minute_limit:=3; hour_limit:=12;
  when 'live-create' then minute_limit:=6; hour_limit:=40;
  else raise exception 'Invalid quota scope' using errcode = '22023';
 end case;
 foreach period_seconds in array array[60,3600] loop
  period_limit:=case when period_seconds=60 then minute_limit else hour_limit end;
  boundary:=pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp())/period_seconds)*period_seconds);
  insert into hush_private.ai_limits as ledger(user_id,scope,period_seconds,window_start,count)
   values(owner_id,requested_scope,period_seconds,boundary,1)
   on conflict on constraint ai_limits_pkey do update
   set window_start=excluded.window_start,count=case when ledger.window_start=excluded.window_start then ledger.count+1 else 1 end
   returning count into current_count;
  if current_count>period_limit then allowed:=false; end if;
 end loop;
 return allowed;
end;
$$;
revoke all on function public.hush_consume_ai_quota(text) from public, anon;
grant execute on function public.hush_consume_ai_quota(text) to authenticated;
commit;
