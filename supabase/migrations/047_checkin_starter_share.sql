-- 047: গ্রাহক বাড়ানো — প্রতিদিন চেক-ইন (৭ দিনের ধারা, কয়েন), নতুনদের চেকলিস্ট (ছবি / প্রথম ভিডিও / ৩ জনকে ফলো), ভিডিও শেয়ার পেজ (public_video)
-- পুরস্কার শুধু কয়েন (উইথড্র হয় না)। প্রতারণা রোধ: APK ডিভাইস লাগে, একই মোবাইলে একাধিক অ্যাকাউন্ট একই পুরস্কার পায় না।

insert into settings (key, value, description) values
  ('checkin_enabled', 'true', 'প্রতিদিন চেক-ইন চালু'),
  ('checkin_rewards', '[2,3,5,5,8,10,20]', 'চেক-ইনের ৭ দিনের কয়েন (দিন ১…৭, তারপর আবার ১ থেকে)'),
  ('bonus_need_device', 'true', 'চেক-ইন ও নতুনদের পুরস্কার শুধু APK-তে, এক মোবাইলে এক অ্যাকাউন্ট'),
  ('starter_enabled', 'true', 'নতুনদের চেকলিস্ট চালু'),
  ('starter_days', '7', 'অ্যাকাউন্ট খোলার কত দিনের মধ্যে চেকলিস্ট দেখাবে'),
  ('starter_follow_need', '3', 'চেকলিস্ট: কতজনকে ফলো করতে হবে'),
  ('starter_rewards', '{"avatar":5,"video":20,"follow":5,"done":20}', 'চেকলিস্টের কয়েন: ছবি, প্রথম ভিডিও, ফলো, সব শেষ')
on conflict (key) do nothing;

create table if not exists daily_checkins (
  user_id uuid not null references profiles(id) on delete cascade,
  day date not null,
  streak int not null,
  coins int not null default 0,
  device_hash text,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists daily_checkins_dev on daily_checkins (day, device_hash);
alter table daily_checkins enable row level security;
drop policy if exists "own checkins" on daily_checkins;
create policy "own checkins" on daily_checkins for select using (user_id = auth.uid());

create table if not exists starter_claims (
  user_id uuid not null references profiles(id) on delete cascade,
  task text not null,
  coins int not null default 0,
  device_hash text,
  created_at timestamptz not null default now(),
  primary key (user_id, task)
);
create index if not exists starter_claims_dev on starter_claims (task, device_hash);
alter table starter_claims enable row level security;
drop policy if exists "own starter" on starter_claims;
create policy "own starter" on starter_claims for select using (user_id = auth.uid());

-- ইউজারের সর্বশেষ APK ডিভাইস
create or replace function public._my_device(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select device_hash from user_devices where user_id = p_user order by last_seen desc nulls last limit 1;
$$;

-- ---------------- চেক-ইন ----------------
create or replace function public.checkin_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _active_user(); d date := today_bd(); t record; y record; s int; rw jsonb := coalesce((select value from settings where key = 'checkin_rewards'), '[]');
begin
  select * into t from daily_checkins where user_id = u and day = d;
  select * into y from daily_checkins where user_id = u and day = d - 1;
  s := case when t.user_id is not null then t.streak when y.user_id is not null then y.streak else 0 end;
  return jsonb_build_object(
    'enabled', coalesce(setting_text('checkin_enabled'), 'false') = 'true',
    'rewards', rw, 'done_today', t.user_id is not null, 'streak', s,
    'cycle_day', case when t.user_id is not null then ((s - 1) % 7) + 1 else (s % 7) + 1 end,
    'next_coins', coalesce((rw ->> (s % 7))::int, 0),
    'need_device', coalesce(setting_text('bonus_need_device'), 'true') = 'true',
    'has_device', _my_device(u) is not null);
end $$;

create or replace function public.daily_checkin() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _active_user(); d date := today_bd(); y record; s int; c int; h text := _my_device(u);
  rw jsonb := coalesce((select value from settings where key = 'checkin_rewards'), '[]');
begin
  if coalesce(setting_text('checkin_enabled'), 'false') <> 'true' then raise exception 'DISABLED'; end if;
  perform 1 from profiles where id = u for update;
  if exists (select 1 from daily_checkins where user_id = u and day = d) then raise exception 'ALREADY_CLAIMED'; end if;
  if coalesce(setting_text('bonus_need_device'), 'true') = 'true' then
    if h is null then raise exception 'NEED_APP'; end if;
    if exists (select 1 from daily_checkins where day = d and device_hash = h and user_id <> u) then raise exception 'DEVICE_USED'; end if;
  end if;
  select * into y from daily_checkins where user_id = u and day = d - 1;
  s := case when y.user_id is not null then y.streak + 1 else 1 end;
  c := greatest(coalesce((rw ->> ((s - 1) % 7))::int, 0), 0);
  insert into daily_checkins (user_id, day, streak, coins, device_hash) values (u, d, s, c, h);
  if c > 0 then perform _wallet_move(u, 'coin', c, 'checkin_reward', 'checkin', null, '📅 চেক-ইন দিন ' || (((s - 1) % 7) + 1), 'chk:' || u || ':' || d); end if;
  return jsonb_build_object('ok', true, 'coins', c, 'streak', s, 'cycle_day', ((s - 1) % 7) + 1);
end $$;

-- ---------------- নতুনদের চেকলিস্ট ----------------
create or replace function public._starter_items(u uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p record; rw jsonb := coalesce((select value from settings where key = 'starter_rewards'), '{}'); need int := greatest(setting_int('starter_follow_need'), 1);
  nf int; hv boolean; ha boolean; cl text[];
begin
  select * into p from profiles where id = u;
  select count(*) into nf from follows where follower_id = u;
  hv := exists (select 1 from videos where user_id = u and status = 'published');
  ha := coalesce(p.avatar_url, '') <> '';
  select coalesce(array_agg(task), '{}') into cl from starter_claims where user_id = u;
  return jsonb_build_array(
    jsonb_build_object('k', 'avatar', 'done', ha, 'claimed', 'avatar' = any(cl), 'coins', coalesce((rw ->> 'avatar')::int, 0)),
    jsonb_build_object('k', 'video', 'done', hv, 'claimed', 'video' = any(cl), 'coins', coalesce((rw ->> 'video')::int, 0)),
    jsonb_build_object('k', 'follow', 'done', nf >= need, 'claimed', 'follow' = any(cl), 'coins', coalesce((rw ->> 'follow')::int, 0), 'have', least(nf, need), 'need', need),
    jsonb_build_object('k', 'done', 'done', ha and hv and nf >= need, 'claimed', 'done' = any(cl), 'coins', coalesce((rw ->> 'done')::int, 0)));
end $$;

create or replace function public.starter_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _active_user(); p record; ends timestamptz;
begin
  select * into p from profiles where id = u;
  ends := p.created_at + make_interval(days => greatest(setting_int('starter_days'), 1)::int);
  return jsonb_build_object(
    'enabled', coalesce(setting_text('starter_enabled'), 'false') = 'true' and now() < ends and p.role <> 'admin',
    'ends_at', ends, 'items', _starter_items(u),
    'need_device', coalesce(setting_text('bonus_need_device'), 'true') = 'true', 'has_device', _my_device(u) is not null);
end $$;

create or replace function public.starter_claim(p_task text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _active_user(); p record; it jsonb; h text := _my_device(u); c int;
begin
  if coalesce(setting_text('starter_enabled'), 'false') <> 'true' then raise exception 'DISABLED'; end if;
  select * into p from profiles where id = u for update;
  if now() > p.created_at + make_interval(days => greatest(setting_int('starter_days'), 1)::int) then raise exception 'EXPIRED'; end if;
  select x into it from jsonb_array_elements(_starter_items(u)) x where x ->> 'k' = p_task;
  if it is null then raise exception 'NOT_FOUND'; end if;
  if (it ->> 'claimed')::boolean then raise exception 'ALREADY_CLAIMED'; end if;
  if not (it ->> 'done')::boolean then raise exception 'NOT_DONE'; end if;
  if coalesce(setting_text('bonus_need_device'), 'true') = 'true' then
    if h is null then raise exception 'NEED_APP'; end if;
    if exists (select 1 from starter_claims where task = p_task and device_hash = h and user_id <> u) then raise exception 'DEVICE_USED'; end if;
  end if;
  c := greatest(coalesce((it ->> 'coins')::int, 0), 0);
  insert into starter_claims (user_id, task, coins, device_hash) values (u, p_task, c, h);
  if c > 0 then perform _wallet_move(u, 'coin', c, 'starter_reward', 'starter', null, '🎯 নতুনদের কাজ: ' || p_task, 'str:' || u || ':' || p_task); end if;
  return jsonb_build_object('ok', true, 'coins', c);
end $$;

-- ---------------- অ্যাডমিন হিসাব ----------------
create or replace function public.admin_growth_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_admin();
  return jsonb_build_object(
    'today', (select jsonb_build_object('users', count(*), 'coins', coalesce(sum(coins), 0)) from daily_checkins where day = today_bd()),
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', g.d::date, 'users', (select count(*) from daily_checkins c where c.day = g.d::date),
               'coins', (select coalesce(sum(coins), 0) from daily_checkins c where c.day = g.d::date)) order by g.d desc), '[]')
             from generate_series(today_bd() - 6, today_bd(), interval '1 day') g(d)),
    'streak7', (select count(*) from daily_checkins where day = today_bd() and streak >= 7),
    'starter', (select coalesce(jsonb_object_agg(task, jsonb_build_object('users', n, 'coins', s)), '{}')
               from (select task, count(*) n, sum(coins) s from starter_claims group by task) q),
    'new_users_7d', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'new_with_video_7d', (select count(*) from profiles pr where created_at > now() - interval '7 days'
                          and exists (select 1 from videos v where v.user_id = pr.id)));
end $$;

-- ---------------- ভিডিও শেয়ার পেজ (লগইন ছাড়া) ----------------
create or replace function public.public_video(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  select vv.id, vv.video_url, vv.thumb_url, vv.caption, vv.duration_sec, vv.views_count, vv.likes_count, vv.comments_count, vv.user_id,
         pr.username, pr.full_name, pr.avatar_url, pr.user_no, pr.followers_count
    into v from videos vv join profiles pr on pr.id = vv.user_id
   where vv.id = p_id and vv.status = 'published' and not coalesce(vv.is_premium, false) and pr.status = 'active';
  if v.id is null then return null; end if;
  return jsonb_build_object('id', v.id, 'video_url', v.video_url, 'thumb_url', v.thumb_url, 'caption', left(coalesce(v.caption, ''), 300),
    'duration_sec', v.duration_sec, 'views', v.views_count, 'likes', v.likes_count, 'comments', v.comments_count,
    'username', v.username, 'full_name', v.full_name, 'avatar_url', v.avatar_url, 'user_no', v.user_no, 'followers', v.followers_count,
    'more', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'thumb_url', x.thumb_url, 'views', x.views_count)), '[]') from
              (select id, thumb_url, views_count from videos where status = 'published' and not coalesce(is_premium, false)
                 and id <> p_id and thumb_url is not null order by (user_id = v.user_id) desc, views_count desc, id desc limit 6) x));
end $$;

revoke all on function public.checkin_status(), public.daily_checkin(), public.starter_status(), public.starter_claim(text),
  public.admin_growth_stats(), public._starter_items(uuid), public._my_device(uuid), public.public_video(bigint) from public, anon;
grant execute on function public.checkin_status(), public.daily_checkin(), public.starter_status(), public.starter_claim(text),
  public.admin_growth_stats() to authenticated;
grant execute on function public.public_video(bigint) to anon, authenticated;
