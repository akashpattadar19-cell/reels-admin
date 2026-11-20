-- 052: টেলিগ্রাম গ্রুপে নতুন ভিডিও → Approve / Reject বোতাম
alter table public.videos add column if not exists tg_sent_at timestamptz;
update public.videos set tg_sent_at = now() where tg_sent_at is null;   -- পুরনোগুলো পাঠাবে না
insert into public.private_config(key, value) values ('tg_cron_secret', replace(gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;

-- টেলিগ্রাম বোতাম থেকে (edge function, service role) অ্যাডমিন হিসেবে কাজ করা
create or replace function public._tg_video_action(p_admin uuid, p_id bigint, p_action text, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if p_action not in ('approve','reject') then raise exception 'BAD_ACTION'; end if;
  if not exists (select 1 from profiles where id = p_admin and role = 'admin' and status = 'active') then raise exception 'NOT_ADMIN'; end if;
  select status into st from videos where id = p_id;
  if st is null then return 'missing'; end if;
  if st <> 'pending' then return st; end if;
  perform set_config('request.jwt.claim.sub', p_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_admin, 'role', 'authenticated')::text, true);
  perform public.admin_video_action(p_id, p_action, p_reason);
  return 'done';
end $$;
revoke all on function public._tg_video_action(uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public._tg_video_action(uuid,bigint,text,text) to service_role;

-- প্রতি মিনিটে: পাঠানো বাকি এমন পেন্ডিং ভিডিও থাকলে edge function ডাকে
create or replace function public.tg_mod_cron() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from private_config where key = 'telegram_mod_chat' and value is not null and value <> '') then return; end if;
  if not exists (select 1 from videos where status = 'pending' and tg_sent_at is null and created_at < now() - interval '20 seconds') then return; end if;
  perform net.http_post(
    url := 'https://smveeoykybpufhvcehjv.supabase.co/functions/v1/support-telegram',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron', (select value from private_config where key = 'tg_cron_secret')),
    body := '{"action":"mod_run"}'::jsonb, timeout_milliseconds := 60000);
end $$;
revoke all on function public.tg_mod_cron() from public, anon, authenticated;
select cron.unschedule('tg-mod') where exists (select 1 from cron.job where jobname = 'tg-mod');
select cron.schedule('tg-mod', '* * * * *', 'select public.tg_mod_cron()');

create or replace function public.admin_telegram_status() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return json_build_object(
    'has_token', exists (select 1 from private_config where key = 'telegram_bot_token' and value is not null),
    'bot', (select value from private_config where key = 'telegram_bot_username'),
    'linked', exists (select 1 from private_config where key = 'telegram_chat_id' and value is not null),
    'link_code', (select value from private_config where key = 'telegram_link_code'),
    'mod_linked', exists (select 1 from private_config where key = 'telegram_mod_chat' and value is not null and value <> ''),
    'mod_title', (select value from private_config where key = 'telegram_mod_title'),
    'mod_code', (select value from private_config where key = 'telegram_mod_code'),
    'pending', (select count(*) from videos where status = 'pending'));
end $$;

-- নতুন গ্রুপ-কোড বানানো / গ্রুপ বাদ দেওয়া
create or replace function public.admin_telegram_mod(p_action text) returns json
language plpgsql security definer set search_path = public as $$
declare c text := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
begin
  perform public._require_admin();
  if p_action = 'code' then
    insert into private_config(key, value) values ('telegram_mod_code', c) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into private_config(key, value) values ('telegram_admin_uid', auth.uid()::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  elsif p_action = 'unlink' then
    update private_config set value = null, updated_at = now() where key in ('telegram_mod_chat', 'telegram_mod_title');
  else raise exception 'BAD_ACTION'; end if;
  return public.admin_telegram_status();
end $$;
grant execute on function public.admin_telegram_mod(text) to authenticated;
revoke execute on function public.admin_telegram_mod(text) from anon, public;
