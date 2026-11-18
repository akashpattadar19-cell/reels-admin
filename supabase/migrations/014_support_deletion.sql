-- 014: live support (users & hosts) with Telegram bridge, account deletion requests

create table if not exists support_threads (
  user_id uuid primary key references profiles(id) on delete cascade,
  kind text not null default 'user' check (kind in ('user','host')),
  status text not null default 'open' check (status in ('open','closed')),
  last_at timestamptz not null default now(),
  last_body text,
  unread_admin int not null default 0,
  unread_user int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists support_threads_idx on support_threads (kind, status, last_at desc);

create table if not exists support_messages (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  from_admin boolean not null default false,
  body text not null check (char_length(body) between 1 and 2000),
  via text not null default 'app' check (via in ('app','telegram','admin')),
  admin_id uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_idx on support_messages (user_id, id);

-- secrets only the edge function (service role) can read
create table if not exists private_config (key text primary key, value text, updated_at timestamptz not null default now());

alter table support_threads enable row level security;
alter table support_messages enable row level security;
alter table private_config enable row level security;
drop policy if exists st_read on support_threads;
create policy st_read on support_threads for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists sm_read on support_messages;
create policy sm_read on support_messages for select to authenticated using (user_id = auth.uid() or public.is_admin());

do $$ begin
  begin alter publication supabase_realtime add table support_messages; exception when others then null; end;
end $$;

alter table profiles add column if not exists deletion_requested_at timestamptz;

insert into settings (key, value, description, is_public) values
  ('support_enabled', 'true', 'লাইভ সাপোর্ট চালু', true),
  ('support_telegram', '""', 'ইউজারদের জন্য সাপোর্ট টেলিগ্রাম (যেমন @ReelsEnjoySupport)', true),
  ('support_email', '"mdakashpattadar19@gmail.com"', 'সাপোর্ট/পলিসির ইমেইল', true),
  ('support_hours', to_jsonb('সাধারণত ১২ ঘণ্টার মধ্যে উত্তর দেওয়া হয়'::text), 'সাপোর্টে উত্তরের সময়', true)
on conflict (key) do nothing;

-- ---------- support ----------
create or replace function public.support_send(p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); b text := left(trim(coalesce(p_body, '')), 2000); id_ bigint; k text; st text;
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  select status into st from profiles where id = u;
  if st = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if b = '' then raise exception 'EMPTY'; end if;
  if coalesce(public.setting_text('support_enabled'), 'true') <> 'true' then raise exception 'SUPPORT_OFF'; end if;
  if (select count(*) from support_messages where user_id = u and not from_admin and created_at > now() - interval '1 minute') >= 6 then
    raise exception 'RATE_LIMIT';
  end if;
  select case when account_type = 'host' then 'host' else 'user' end into k from profiles where id = u;
  insert into support_messages (user_id, body) values (u, b) returning id into id_;
  insert into support_threads (user_id, kind, status, last_at, last_body, unread_admin)
  values (u, k, 'open', now(), left(b, 200), 1)
  on conflict (user_id) do update set kind = excluded.kind, status = 'open', last_at = now(), last_body = excluded.last_body,
    unread_admin = support_threads.unread_admin + 1;
  return id_;
end $$;

create or replace function public.support_my_messages() returns setof support_messages
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  update support_threads set unread_user = 0 where user_id = auth.uid() and unread_user > 0;
  return query select * from support_messages where user_id = auth.uid() order by id desc limit 200;
end $$;

-- shared by admin panel and the Telegram bridge
create or replace function public._support_reply(p_user uuid, p_body text, p_via text, p_admin uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare id_ bigint; b text := left(trim(coalesce(p_body, '')), 2000);
begin
  if b = '' then raise exception 'EMPTY'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'NOT_FOUND'; end if;
  insert into support_messages (user_id, from_admin, body, via, admin_id) values (p_user, true, b, p_via, p_admin) returning id into id_;
  insert into support_threads (user_id, kind, last_at, last_body, unread_user, unread_admin)
  values (p_user, (select case when account_type = 'host' then 'host' else 'user' end from profiles where id = p_user), now(), left(b, 200), 1, 0)
  on conflict (user_id) do update set last_at = now(), last_body = excluded.last_body,
    unread_user = support_threads.unread_user + 1, unread_admin = 0;
  perform public._notify(p_user, 'system', '🎧 সাপোর্ট থেকে উত্তর এসেছে', left(b, 120), '{"support":true}'::jsonb);
  return id_;
end $$;

create or replace function public.admin_support_reply(p_user uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  return public._support_reply(p_user, p_body, 'admin', auth.uid());
end $$;

create or replace function public.support_reply_by_user_no(p_user_no bigint, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  select id into u from profiles where user_no = p_user_no;
  if u is null then raise exception 'NOT_FOUND'; end if;
  return public._support_reply(u, p_body, 'telegram', null);
end $$;

create or replace function public.admin_support_threads(p_kind text, p_status text default 'open')
returns table(user_id uuid, user_no bigint, username text, full_name text, avatar_url text, country_code text,
              kind text, status text, last_at timestamptz, last_body text, unread_admin int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query select t.user_id, p.user_no, p.username, p.full_name, p.avatar_url, p.country_code, t.kind, t.status,
                      t.last_at, t.last_body, t.unread_admin
    from support_threads t join profiles p on p.id = t.user_id
   where (p_kind is null or t.kind = p_kind) and (p_status is null or p_status = '' or t.status = p_status)
   order by t.unread_admin > 0 desc, t.last_at desc limit 300;
end $$;

create or replace function public.admin_support_open(p_user uuid) returns setof support_messages
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update support_threads set unread_admin = 0 where user_id = p_user;
  return query select * from support_messages where user_id = p_user order by id desc limit 300;
end $$;

create or replace function public.admin_support_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_status not in ('open','closed') then raise exception 'BAD_STATUS'; end if;
  update support_threads set status = p_status, unread_admin = case when p_status = 'closed' then 0 else unread_admin end where user_id = p_user;
end $$;

create or replace function public.admin_support_counts() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return (select json_build_object(
    'user', count(*) filter (where kind = 'user' and status = 'open' and unread_admin > 0),
    'host', count(*) filter (where kind = 'host' and status = 'open' and unread_admin > 0),
    'deletions', (select count(*) from profiles where deletion_requested_at is not null and status = 'active'))
    from support_threads);
end $$;

-- Telegram bot settings: admin writes, only the edge function (service role) reads
create or replace function public.admin_set_private_config(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_key not in ('telegram_bot_token') then raise exception 'BAD_KEY'; end if;
  insert into private_config (key, value, updated_at) values (p_key, nullif(trim(p_value), ''), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if p_key = 'telegram_bot_token' then
    delete from private_config where key in ('telegram_chat_id', 'telegram_webhook_secret', 'telegram_bot_username');
  end if;
end $$;

create or replace function public.admin_telegram_status() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return json_build_object(
    'has_token', exists (select 1 from private_config where key = 'telegram_bot_token' and value is not null),
    'bot', (select value from private_config where key = 'telegram_bot_username'),
    'linked', exists (select 1 from private_config where key = 'telegram_chat_id' and value is not null),
    'link_code', (select value from private_config where key = 'telegram_link_code'));
end $$;

-- ---------- account deletion ----------
create or replace function public.request_account_deletion(p_cancel boolean default false) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  if public.is_admin() then raise exception 'ADMIN_ACCOUNT'; end if;
  update profiles set deletion_requested_at = case when p_cancel then null else coalesce(deletion_requested_at, now()) end where id = u;
  return (select deletion_requested_at from profiles where id = u);
end $$;

-- anonymise: removes personal data and content, keeps money ledger rows (needed for accounting/law)
create or replace function public._delete_account(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare no_ bigint;
begin
  select user_no into no_ from profiles where id = p_user;
  if no_ is null then return; end if;
  update videos set status = 'deleted' where user_id = p_user and status <> 'deleted';
  update posts set status = 'deleted' where user_id = p_user and status <> 'deleted';
  delete from messages where sender_id = p_user or receiver_id = p_user;
  delete from support_messages where user_id = p_user;
  delete from support_threads where user_id = p_user;
  delete from vault_files where user_id = p_user;
  delete from follows where follower_id = p_user or following_id = p_user;
  update user_private set phone = 'deleted:' || no_, email = null, birth_date = null, country = null, city = null,
         last_lat = null, last_lon = null where user_id = p_user;
  update profiles set username = 'deleted_' || no_, full_name = null, avatar_url = null, cover_url = null, bio = null,
         status = 'banned', ban_reason = 'অ্যাকাউন্ট ডিলিট করা হয়েছে', followers_count = 0, following_count = 0,
         deletion_requested_at = null where id = p_user;
end $$;

create or replace function public.admin_delete_account(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_user = auth.uid() then raise exception 'SELF'; end if;
  perform public._delete_account(p_user);
  perform public._audit('delete_account', 'user', p_user::text, null, '{}'::jsonb);
end $$;

create or replace function public.process_account_deletions() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from profiles where deletion_requested_at < now() - interval '7 days' and role <> 'admin' loop
    perform public._delete_account(r.id); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.admin_deletion_requests() returns table(id uuid, user_no bigint, username text, requested_at timestamptz,
  earning_paisa bigint, pending_paisa bigint, coin_balance bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query select p.id, p.user_no, p.username, p.deletion_requested_at, w.earning_paisa, w.pending_paisa, w.coin_balance
    from profiles p left join wallets w on w.user_id = p.id
   where p.deletion_requested_at is not null and p.status = 'active' order by p.deletion_requested_at;
end $$;

do $$ begin
  perform cron.unschedule('process-account-deletions');
exception when others then null; end $$;
select cron.schedule('process-account-deletions', '17 3 * * *', $$select public.process_account_deletions()$$);

do $$
declare f text;
begin
  foreach f in array array[
    'public.support_send(text)', 'public.support_my_messages()', 'public.admin_support_reply(uuid, text)',
    'public.admin_support_threads(text, text)', 'public.admin_support_open(uuid)', 'public.admin_support_status(uuid, text)',
    'public.admin_support_counts()', 'public.admin_set_private_config(text, text)', 'public.admin_telegram_status()',
    'public.request_account_deletion(boolean)', 'public.admin_delete_account(uuid)', 'public.admin_deletion_requests()'
  ] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array array['public._support_reply(uuid, text, text, uuid)', 'public.support_reply_by_user_no(bigint, text)',
                           'public._delete_account(uuid)', 'public.process_account_deletions()'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
