-- 041: ভিডিও Cloudflare R2-তে সরানো
-- আপলোড আগের মতোই Supabase storage-এ হয় (ওয়েব, APK এডিটর, স্টোরি — কোনো APK আপডেট লাগে না)।
-- cron `r2-move` প্রতি মিনিটে কাজ থাকলে edge function `r2-move` ডাকে → ফাইল R2-তে কপি → videos.video_url / stories.media_url
-- R2-এর পাবলিক লিংকে বদলায় → Supabase থেকে ফাইল মুছে দেয়। R2 key থাকে private_config-এ (শুধু service role পড়তে পারে)।
create extension if not exists pg_net with schema extensions;

alter table videos  add column if not exists r2_tries smallint not null default 0;
alter table stories add column if not exists r2_tries smallint not null default 0;

insert into settings (key, value, description) values
  ('r2_enabled', 'false', 'নতুন ভিডিও Cloudflare R2-তে সরানো চালু')
on conflict (key) do nothing;

insert into private_config (key, value) values ('r2_cron_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

create or replace function public.admin_set_private_config(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_key not in ('telegram_bot_token', 'r2_account_id', 'r2_access_key', 'r2_secret_key', 'r2_bucket', 'r2_public_url') then
    raise exception 'BAD_KEY';
  end if;
  if p_key = 'r2_public_url' then p_value := regexp_replace(trim(coalesce(p_value, '')), '/+$', ''); end if;
  if p_key = 'r2_public_url' and p_value <> '' and p_value !~ '^https://' then raise exception 'BAD_URL'; end if;
  insert into private_config (key, value, updated_at) values (p_key, nullif(trim(p_value), ''), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if p_key = 'telegram_bot_token' then
    delete from private_config where key in ('telegram_chat_id', 'telegram_webhook_secret', 'telegram_bot_username');
  end if;
end $$;

-- সরানোর অপেক্ষায় থাকা ফাইল (আপলোডের ১ মিনিট পর, ৫ বারের বেশি ব্যর্থ হলে বাদ)
create or replace function public._r2_pending_count() returns integer
language sql stable security definer set search_path = public as $$
  select (select count(*) from videos where video_url like '%/storage/v1/object/public/videos/%' and r2_tries < 5
            and created_at < now() - interval '1 minute')::int
       + (select count(*) from stories where kind = 'video' and media_url like '%/storage/v1/object/public/videos/%' and r2_tries < 5
            and created_at < now() - interval '1 minute')::int;
$$;

create or replace function public.admin_r2_status() returns json
language plpgsql stable security definer set search_path = public as $$
declare pub text := (select value from private_config where key = 'r2_public_url');
begin
  perform public._require_admin();
  return json_build_object(
    'account', (select value from private_config where key = 'r2_account_id'),
    'bucket', (select value from private_config where key = 'r2_bucket'),
    'public_url', pub,
    'has_key', exists (select 1 from private_config where key = 'r2_access_key' and value is not null),
    'has_secret', exists (select 1 from private_config where key = 'r2_secret_key' and value is not null),
    'enabled', coalesce((select value::text = 'true' from settings where key = 'r2_enabled'), false),
    'on_r2', (select count(*) from videos where pub is not null and video_url like pub || '/%'),
    'on_supabase', (select count(*) from videos where video_url like '%/storage/v1/object/public/videos/%'),
    'failed', (select count(*) from videos where video_url like '%/storage/v1/object/public/videos/%' and r2_tries >= 5),
    'supabase_mb', (select round(coalesce(sum((metadata->>'size')::bigint), 0) / 1048576.0, 1) from storage.objects),
    'videos_mb', (select round(coalesce(sum((metadata->>'size')::bigint), 0) / 1048576.0, 1) from storage.objects where bucket_id = 'videos'));
end $$;

-- ব্যর্থ ভিডিও আবার চেষ্টা
create or replace function public.admin_r2_retry() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public._require_admin();
  update videos set r2_tries = 0 where r2_tries >= 5 and video_url like '%/storage/v1/object/public/videos/%';
  get diagnostics n = row_count;
  update stories set r2_tries = 0 where r2_tries >= 5;
  return n;
end $$;

-- cron: কাজ থাকলে তবেই function ডাকে
create or replace function public.r2_cron() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not coalesce((select value::text = 'true' from settings where key = 'r2_enabled'), false) then return; end if;
  if public._r2_pending_count() = 0 then return; end if;
  perform net.http_post(
    url := 'https://smveeoykybpufhvcehjv.supabase.co/functions/v1/r2-move',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron', (select value from private_config where key = 'r2_cron_secret')),
    body := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 120000);
end $$;

revoke all on function public._r2_pending_count(), public.r2_cron() from public, anon, authenticated;
revoke all on function public.admin_r2_status(), public.admin_r2_retry() from public, anon;
grant execute on function public.admin_r2_status(), public.admin_r2_retry() to authenticated;

select cron.unschedule('r2-move') where exists (select 1 from cron.job where jobname = 'r2-move');
select cron.schedule('r2-move', '* * * * *', 'select public.r2_cron()');
