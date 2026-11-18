-- 011: Host/User account type, premium (coin-locked) videos, jail with coin release fee,
--      per-user daily upload limit, language + level for the discover grid.

alter table profiles
  add column if not exists account_type text not null default 'user' check (account_type in ('user','host')),
  add column if not exists host_requested_at timestamptz,
  add column if not exists daily_upload_limit int check (daily_upload_limit is null or daily_upload_limit >= 0),
  add column if not exists language text not null default 'Bengali',
  add column if not exists jailed boolean not null default false,
  add column if not exists jail_reason text,
  add column if not exists jail_fee_coins bigint,
  add column if not exists jailed_at timestamptz;

alter table videos
  add column if not exists is_premium boolean not null default false,
  add column if not exists premium_coins int check (premium_coins is null or premium_coins between 1 and 100000);

create table if not exists premium_unlocks (
  user_id uuid not null references profiles(id) on delete cascade,
  video_id bigint not null references videos(id) on delete cascade,
  coins int not null,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
alter table premium_unlocks enable row level security;
drop policy if exists pu_own on premium_unlocks;
create policy pu_own on premium_unlocks for select to authenticated using (user_id = auth.uid() or public.is_admin());

insert into settings (key, value, description, is_public) values
  ('daily_upload_limit',      '5',     'নতুন ইউজার দিনে কয়টি ভিডিও আপলোড করতে পারবে', true),
  ('jail_release_coins',      '100',   'জেল থেকে মুক্ত হতে ডিফল্ট কয়েন', true),
  ('host_auto_approve',       'false', 'হোস্ট আবেদন অটো অনুমোদন', true),
  ('premium_default_coins',   '10',    'প্রিমিয়াম ভিডিও দেখার ডিফল্ট কয়েন', true),
  ('premium_creator_pct',     '60',    'প্রিমিয়াম আনলকের কত % ক্রিয়েটর পাবে', true)
on conflict (key) do nothing;

-- level from followers
create or replace function public._level(f int) returns int language sql immutable as $$
  select case when f >= 20000 then 6 when f >= 5000 then 5 when f >= 1000 then 4 when f >= 200 then 3
              when f >= 50 then 2 when f >= 10 then 1 else 0 end;
$$;

-- jailed users can't act (they can still browse and pay the release fee)
create or replace function public._active_user() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); p record;
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  select status, jailed into p from profiles where id = u;
  if p.status = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if p.jailed then raise exception 'JAILED'; end if;
  return u;
end $$;

-- location must keep working while jailed
create or replace function public.update_location(p_lat numeric, p_lon numeric, p_country text, p_country_code text, p_city text)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  update user_private set last_lat = round(p_lat, 2), last_lon = round(p_lon, 2), country = left(p_country, 60),
         country_code = upper(left(p_country_code, 2)), city = left(p_city, 80), location_at = now(), last_seen = now()
   where user_id = u;
  update profiles set country_code = upper(left(p_country_code, 2)) where id = u and p_country_code is not null;
end $$;

-- upload limit per user
create or replace function public.create_video(p_video_path text, p_video_url text, p_thumb_url text, p_caption text, p_duration integer)
returns bigint language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); v_id bigint; t text; h_id bigint; adm boolean := public.is_admin(); lim int;
begin
  if p_video_path is null or split_part(p_video_path, '/', 1) <> u::text then raise exception 'BAD_PATH'; end if;
  if p_video_url not like '%/storage/v1/object/public/videos/' || p_video_path then raise exception 'BAD_URL'; end if;
  if p_thumb_url is not null and p_thumb_url not like '%/storage/v1/object/public/thumbs/' || u::text || '/%' then
    raise exception 'BAD_THUMB';
  end if;
  if p_duration is not null and p_duration > public.setting_int('max_video_sec') + 2 then raise exception 'VIDEO_TOO_LONG'; end if;
  select coalesce(daily_upload_limit, public.setting_int('daily_upload_limit')::int) into lim from profiles where id = u;
  if not adm and (select count(*) from videos where user_id = u and created_at > now() - interval '1 day') >= lim then
    raise exception 'UPLOAD_LIMIT';
  end if;
  insert into videos (user_id, caption, video_path, video_url, thumb_url, duration_sec, uploaded_by_admin, status, approved_at)
  values (u, nullif(trim(p_caption), ''), p_video_path, p_video_url, p_thumb_url, p_duration, adm,
          case when adm then 'published' else 'pending' end, case when adm then now() end)
  returning id into v_id;
  update profiles set videos_count = videos_count + 1 where id = u;
  for t in select distinct lower(m[1]) from regexp_matches(coalesce(p_caption, ''), '#([^\s#]{1,60})', 'g') as m loop
    insert into hashtags (tag, use_count) values (t, 1)
      on conflict (tag) do update set use_count = hashtags.use_count + 1 returning id into h_id;
    insert into video_hashtags values (v_id, h_id) on conflict do nothing;
  end loop;
  return v_id;
end $$;

create or replace function public.my_upload_quota() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'limit', coalesce(p.daily_upload_limit, public.setting_int('daily_upload_limit')::int),
    'used', (select count(*) from videos where user_id = p.id and created_at > now() - interval '1 day'))
  from profiles p where p.id = auth.uid();
$$;

-- premium flag set by the owner right after upload (premium never auto-approves)
create or replace function public.set_video_premium(p_video bigint, p_premium boolean, p_coins int)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  update videos set is_premium = coalesce(p_premium, false),
         premium_coins = case when p_premium then greatest(1, least(coalesce(p_coins, public.setting_int('premium_default_coins')::int), 100000)) end
   where id = p_video and (user_id = u or public.is_admin());
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create or replace function public.auto_approve_videos() returns integer
language plpgsql security definer set search_path = public as $$
declare m int := public.setting_int('auto_approve_minutes')::int; n int;
begin
  if m <= 0 then return 0; end if;
  update videos set status = 'published', approved_at = now()
   where status = 'pending' and not is_premium and created_at <= now() - make_interval(mins => m);
  get diagnostics n = row_count;
  return n;
end $$;

-- can the caller watch this premium video for free?
create or replace function public._premium_free(p_video_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = p_video_owner or public.is_admin()
      or exists (select 1 from profiles where id = auth.uid() and account_type = 'host');
$$;

drop function if exists public.feed(text, bigint, int, uuid, text);
create or replace function public.feed(p_type text default 'foryou', p_before bigint default null, p_limit int default 10,
                                       p_user uuid default null, p_category text default null,
                                       p_lang text default null, p_country text default null)
returns table(id bigint, user_id uuid, username text, full_name text, avatar_url text, is_verified boolean, caption text,
              video_url text, thumb_url text, views_count bigint, likes_count int, comments_count int, shares_count int,
              gifts_coins_total bigint, allow_comments boolean, allow_gifts boolean, is_featured boolean,
              created_at timestamptz, liked_by_me boolean, following boolean, category text,
              country_code text, language text, level int, account_type text,
              is_premium boolean, premium_coins int, locked boolean)
language sql stable security definer set search_path = public as $$
  with me as (select country_code from profiles where id = auth.uid())
  select v.id, v.user_id, p.username, p.full_name, p.avatar_url, p.is_verified, v.caption,
         case when lk.locked then null else v.video_url end,
         v.thumb_url, v.views_count, v.likes_count, v.comments_count, v.shares_count, v.gifts_coins_total,
         v.allow_comments, v.allow_gifts, v.is_featured, v.created_at,
         exists (select 1 from likes l where l.video_id = v.id and l.user_id = auth.uid()),
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = v.user_id),
         v.category, p.country_code, p.language, public._level(p.followers_count), p.account_type,
         v.is_premium, v.premium_coins, lk.locked
  from videos v join profiles p on p.id = v.user_id
  cross join lateral (select v.is_premium and not public._premium_free(v.user_id)
                        and not exists (select 1 from premium_unlocks u where u.user_id = auth.uid() and u.video_id = v.id) as locked) lk
  where v.status = 'published' and p.status = 'active'
    and (p_before is null or v.id < p_before)
    and (p_user is null or v.user_id = p_user)
    and (p_category is null or p_category = '' or (p_category = 'premium' and v.is_premium) or v.category = p_category)
    and (p_lang is null or p_lang = '' or p.language = p_lang)
    and (p_country is null or p_country = '' or p.country_code = p_country)
    and (p_type <> 'following' or exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = v.user_id))
    and (p_type <> 'nearby' or p.country_code = (select country_code from me))
  order by v.id desc
  limit least(greatest(p_limit, 1), 30);
$$;

create or replace function public.unlock_premium(p_video bigint) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); v record; w record; paisa bigint; creator bigint;
begin
  select id, user_id, status, is_premium, premium_coins, video_url into v from videos where id = p_video;
  if not found or v.status <> 'published' then raise exception 'NOT_FOUND'; end if;
  if not v.is_premium or public._premium_free(v.user_id)
     or exists (select 1 from premium_unlocks where user_id = u and video_id = p_video) then
    return json_build_object('ok', true, 'video_url', v.video_url, 'charged', 0);
  end if;
  perform 1 from wallets where user_id in (u, v.user_id) order by user_id for update;
  select * into w from wallets where user_id = u;
  if coalesce(w.coin_balance, 0) < v.premium_coins then raise exception 'INSUFFICIENT_COINS'; end if;
  insert into premium_unlocks (user_id, video_id, coins) values (u, p_video, v.premium_coins);
  perform public._wallet_move(u, 'coin', -v.premium_coins, 'premium_unlock', 'video', p_video, '👑 প্রিমিয়াম ভিডিও', 'pu-s:' || u || ':' || p_video);
  paisa := v.premium_coins::bigint * public.setting_int('coin_price_paisa');
  creator := floor(paisa * public.setting_int('premium_creator_pct') / 100);
  perform public._wallet_move(v.user_id, 'pending', creator, 'gift_received', 'video', p_video, '👑 প্রিমিয়াম আনলক', 'pu-r:' || u || ':' || p_video,
                              now() + make_interval(hours => public.setting_int('pending_hold_hours')::int));
  return json_build_object('ok', true, 'video_url', v.video_url, 'charged', v.premium_coins, 'coin_balance', w.coin_balance - v.premium_coins);
end $$;

-- account type
create or replace function public.set_account_type(p_type text) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  if p_type = 'user' then
    update profiles set account_type = 'user', host_requested_at = null where id = u; return 'user';
  elsif p_type = 'host' then
    if (select account_type from profiles where id = u) = 'host' then return 'host'; end if;
    if coalesce(public.setting_text('host_auto_approve'), 'false') = 'true' then
      update profiles set account_type = 'host', host_requested_at = null where id = u; return 'host';
    end if;
    update profiles set host_requested_at = coalesce(host_requested_at, now()) where id = u; return 'pending';
  end if;
  raise exception 'BAD_TYPE';
end $$;

create or replace function public.set_language(p_lang text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_lang not in ('Bengali','English','Hindi','Urdu','Arabic','Nepali') then raise exception 'BAD_LANG'; end if;
  update profiles set language = p_lang where id = public._active_user();
end $$;

-- jail
create or replace function public.pay_jail_release() returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p record; bal bigint;
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  select * into p from profiles where id = u for update;
  if not p.jailed then return json_build_object('ok', true); end if;
  if p.status = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  insert into wallets (user_id) values (u) on conflict do nothing;
  select coin_balance into bal from wallets where user_id = u for update;
  if bal < coalesce(p.jail_fee_coins, 0) then raise exception 'INSUFFICIENT_COINS'; end if;
  perform public._wallet_move(u, 'coin', -coalesce(p.jail_fee_coins, 0), 'jail_release', 'user', null, '🔓 জেল থেকে মুক্তি');
  update profiles set jailed = false, jail_reason = null, jail_fee_coins = null, jailed_at = null where id = u;
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_jail_user(p_user uuid, p_jail boolean, p_reason text, p_fee bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_user = auth.uid() then raise exception 'SELF'; end if;
  if p_jail then
    update profiles set jailed = true, jail_reason = nullif(trim(p_reason), ''), jailed_at = now(),
           jail_fee_coins = greatest(0, coalesce(p_fee, public.setting_int('jail_release_coins')))
     where id = p_user;
    perform public._notify(p_user, 'system', '🚫 আপনার অ্যাকাউন্ট জেলে', coalesce(p_reason, ''), '{}'::jsonb);
  else
    update profiles set jailed = false, jail_reason = null, jail_fee_coins = null, jailed_at = null where id = p_user;
  end if;
  perform public._audit(case when p_jail then 'jail_user' else 'unjail_user' end, 'user', p_user::text, p_reason, '{}'::jsonb);
end $$;

create or replace function public.admin_set_upload_limit(p_user uuid, p_limit int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update profiles set daily_upload_limit = case when p_limit is null or p_limit < 0 then null else p_limit end where id = p_user;
  perform public._audit('upload_limit', 'user', p_user::text, coalesce(p_limit::text, 'default'), '{}'::jsonb);
end $$;

create or replace function public.admin_set_host(p_user uuid, p_host boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update profiles set account_type = case when p_host then 'host' else 'user' end, host_requested_at = null where id = p_user;
  perform public._notify(p_user, 'system', case when p_host then '🎤 আপনি এখন হোস্ট' else 'হোস্ট আবেদন বাতিল' end, '', '{}'::jsonb);
  perform public._audit(case when p_host then 'host_on' else 'host_off' end, 'user', p_user::text, null, '{}'::jsonb);
end $$;

create or replace function public.admin_host_requests() returns table(id uuid, user_no bigint, username text, full_name text, requested_at timestamptz, followers int, videos int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query select p.id, p.user_no, p.username, p.full_name, p.host_requested_at, p.followers_count, p.videos_count
    from profiles p where p.host_requested_at is not null and p.account_type = 'user' order by p.host_requested_at;
end $$;

revoke all on function public.feed(text, bigint, int, uuid, text, text, text), public.my_upload_quota(), public.set_video_premium(bigint, boolean, int),
  public.unlock_premium(bigint), public.set_account_type(text), public.set_language(text), public.pay_jail_release(),
  public.admin_jail_user(uuid, boolean, text, bigint), public.admin_set_upload_limit(uuid, int), public.admin_set_host(uuid, boolean),
  public.admin_host_requests(), public._premium_free(uuid), public._level(int) from public, anon;
grant execute on function public.feed(text, bigint, int, uuid, text, text, text), public.my_upload_quota(), public.set_video_premium(bigint, boolean, int),
  public.unlock_premium(bigint), public.set_account_type(text), public.set_language(text), public.pay_jail_release(),
  public.admin_jail_user(uuid, boolean, text, bigint), public.admin_set_upload_limit(uuid, int), public.admin_set_host(uuid, boolean),
  public.admin_host_requests(), public._premium_free(uuid), public._level(int) to authenticated;
