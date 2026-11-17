-- ===== রেফার =====
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists referral_qualified_at timestamptz;
create index if not exists profiles_referred_by_idx on public.profiles (referred_by);

create table if not exists public.referral_tiers (
  id          serial primary key,
  referrals   int unique not null check (referrals > 0),
  bonus_paisa bigint not null check (bonus_paisa >= 0),
  is_active   boolean not null default true
);
alter table public.referral_tiers enable row level security;
create policy "read all" on public.referral_tiers for select using (true);
create policy "admin write" on public.referral_tiers for all using (public.is_admin()) with check (public.is_admin());
insert into public.referral_tiers (referrals, bonus_paisa) values (10, 5000), (50, 30000), (100, 80000) on conflict do nothing;

create table if not exists public.referral_tier_awards (
  user_id    uuid references public.profiles(id) on delete cascade,
  tier_id    int references public.referral_tiers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tier_id)
);
alter table public.referral_tier_awards enable row level security;
create policy "own or admin" on public.referral_tier_awards for select using (user_id = auth.uid() or public.is_admin());

insert into public.settings (key, value, description, is_public) values
  ('referral_enabled',        'true',  'রেফার ইনকাম চালু/বন্ধ', true),
  ('referral_bonus_paisa',    '1000',  'রেফার: প্রতি সফল রেফারে রেফারকারী পাবে (পয়সা)', true),
  ('referral_welcome_points', '500',   'রেফার: নতুন ইউজার স্বাগত পয়েন্ট পাবে', true),
  ('referral_min_views',      '20',    'রেফার সফল হতে নতুন ইউজারকে কতটি ভিডিও দেখতে হবে', true)
on conflict (key) do nothing;

-- ===== ক্যাটাগরি =====
alter table public.videos add column if not exists category text not null default 'other';
alter table public.videos drop constraint if exists videos_category_check;
alter table public.videos add constraint videos_category_check check (category in ('natok','movie','funny','vlog','music','other'));
create index if not exists videos_category_idx on public.videos (category, id desc) where status = 'published';

-- ===== লোকেশন / জন্মতারিখ =====
alter table public.user_private add column if not exists birth_date date;
alter table public.user_private add column if not exists country text;
alter table public.user_private add column if not exists country_code text;
alter table public.user_private add column if not exists city text;
alter table public.user_private add column if not exists last_lat numeric(7,2);
alter table public.user_private add column if not exists last_lon numeric(7,2);
alter table public.user_private add column if not exists location_at timestamptz;
alter table public.profiles add column if not exists country_code text;   -- প্রোফাইলে দেশের পতাকা দেখাতে

-- ===== সাইনআপে রেফার কোড =====
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}');
        v_username text; ref uuid;
begin
  v_username := lower(coalesce(nullif(m->>'username',''), 'user' || substr(replace(new.id::text,'-',''),1,8)));
  if (m->>'ref_no') ~ '^[0-9]{6,12}$' then
    select id into ref from profiles where user_no = (m->>'ref_no')::bigint;
  end if;
  insert into profiles (id, username, full_name, referred_by) values (new.id, v_username, m->>'full_name', ref);
  if m ? 'phone' then
    insert into user_private (user_id, phone, email, login_email)
    values (new.id, m->>'phone', nullif(lower(m->>'email'), ''), new.email);
  end if;
  insert into wallets (user_id) values (new.id);
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- লেজারে রেফার আয়কে "মোট আয়"-এ গোনা
create or replace function public._wallet_move(
  p_user uuid, p_bucket text, p_amount bigint, p_type text,
  p_ref_type text default null, p_ref_id bigint default null, p_note text default null,
  p_idem text default null, p_available_at timestamptz default null, p_by uuid default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_after bigint; v_earned bigint := 0;
begin
  if p_amount = 0 then return null; end if;
  if p_idem is not null and exists (select 1 from transactions where idem_key = p_idem) then return null; end if;
  insert into wallets (user_id) values (p_user) on conflict do nothing;
  if p_amount > 0 and p_type in ('view_earning','like_earning','comment_earning','gift_received','points_convert',
                                 'referral_bonus','referral_tier_bonus') then
    v_earned := p_amount;
  end if;
  if p_bucket = 'coin' then
    update wallets set coin_balance = coin_balance + p_amount, updated_at = now() where user_id = p_user returning coin_balance into v_after;
  elsif p_bucket = 'earning' then
    update wallets set earning_paisa = earning_paisa + p_amount, total_earned_paisa = total_earned_paisa + v_earned, updated_at = now()
      where user_id = p_user returning earning_paisa into v_after;
  elsif p_bucket = 'pending' then
    update wallets set pending_paisa = pending_paisa + p_amount, total_earned_paisa = total_earned_paisa + v_earned, updated_at = now()
      where user_id = p_user returning pending_paisa into v_after;
  elsif p_bucket = 'points' then
    update wallets set points = points + p_amount, updated_at = now() where user_id = p_user returning points into v_after;
  else
    raise exception 'BAD_BUCKET';
  end if;
  insert into transactions (user_id, type, bucket, amount, balance_after, ref_type, ref_id, note, idem_key, available_at, created_by)
  values (p_user, p_type, p_bucket, p_amount, v_after, p_ref_type, p_ref_id, p_note, p_idem, p_available_at, p_by);
  return v_after;
end $$;
revoke execute on function public._wallet_move from public, anon, authenticated;

-- নতুন ইউজার যথেষ্ট ভিডিও দেখলে রেফার সফল: রেফারকারী টাকা (pending), নতুন ইউজার পয়েন্ট, ধাপে ধাপে বোনাস
create or replace function public._check_referral(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p record; views int; cnt int; t record; uname text;
        hold interval := make_interval(hours => public.setting_int('pending_hold_hours')::int);
begin
  if public.setting_text('referral_enabled') <> 'true' then return; end if;
  select * into p from profiles where id = p_user for update;
  if p.referred_by is null or p.referral_qualified_at is not null then return; end if;
  select count(*) into views from video_views where viewer_id = p_user;
  if views < public.setting_int('referral_min_views') then return; end if;
  if not exists (select 1 from profiles where id = p.referred_by and status = 'active') then return; end if;

  update profiles set referral_qualified_at = now() where id = p_user;
  perform public._wallet_move(p.referred_by, 'pending', public.setting_int('referral_bonus_paisa'), 'referral_bonus',
                              'user', null, '@' || p.username, 'ref:' || p_user, now() + hold);
  perform public._wallet_move(p_user, 'points', public.setting_int('referral_welcome_points'), 'referral_welcome',
                              'user', null, null, 'refw:' || p_user);
  perform public._notify(p.referred_by, 'system', '🎉 রেফার সফল! @' || p.username,
                         'আপনি পাবেন ৳' || round(public.setting_int('referral_bonus_paisa') / 100.0, 2), '{}'::jsonb);

  select count(*) into cnt from profiles where referred_by = p.referred_by and referral_qualified_at is not null;
  for t in select * from referral_tiers where is_active and referrals <= cnt
           and id not in (select tier_id from referral_tier_awards where user_id = p.referred_by) order by referrals loop
    insert into referral_tier_awards (user_id, tier_id) values (p.referred_by, t.id);
    perform public._wallet_move(p.referred_by, 'pending', t.bonus_paisa, 'referral_tier_bonus', 'tier', t.id,
                                t.referrals || ' জন রেফার বোনাস', 'reft:' || p.referred_by || ':' || t.id, now() + hold);
    perform public._notify(p.referred_by, 'system', '🏆 ' || t.referrals || ' জন রেফার বোনাস!',
                           'আপনি পাবেন ৳' || round(t.bonus_paisa / 100.0, 2), '{}'::jsonb);
  end loop;
end $$;
revoke execute on function public._check_referral(uuid) from public, anon, authenticated;

create or replace function public.record_view(p_video_id bigint, p_watch_ms int) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); v record; d date := public.today_bd(); n int; pts int; cap int; got int;
begin
  select id, user_id, status into v from videos where id = p_video_id;
  if not found or v.status <> 'published' or v.user_id = u then return json_build_object('counted', false); end if;
  if p_watch_ms < public.setting_int('min_watch_ms') then return json_build_object('counted', false, 'reason', 'short'); end if;
  if (select count(*) from video_views where viewer_id = u and created_at > now() - interval '1 minute') >= 20 then
    return json_build_object('counted', false, 'reason', 'rate');
  end if;
  insert into video_views (video_id, viewer_id, creator_id, watch_ms, view_date)
  values (p_video_id, u, v.user_id, least(p_watch_ms, 600000), d)
  on conflict (video_id, viewer_id, view_date) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('counted', false, 'reason', 'dup'); end if;
  update videos set views_count = views_count + 1 where id = p_video_id;
  if public.setting_text('earnings_enabled') <> 'true' then return json_build_object('counted', true, 'points', 0); end if;
  insert into creator_daily_stats (user_id, stat_date, valid_views) values (v.user_id, d, 1)
    on conflict (user_id, stat_date) do update set valid_views = creator_daily_stats.valid_views + 1;
  pts := public.setting_int('watch_points');
  cap := public.setting_int('viewer_daily_points_cap');
  insert into viewer_daily_points (user_id, stat_date) values (u, d) on conflict do nothing;
  select points into got from viewer_daily_points where user_id = u and stat_date = d for update;
  pts := greatest(least(pts, cap - got), 0);
  if pts > 0 then
    update viewer_daily_points set points = points + pts where user_id = u and stat_date = d;
    perform public._wallet_move(u, 'points', pts, 'watch_reward', 'video', p_video_id, null, 'watch:' || u || ':' || p_video_id || ':' || d);
  end if;
  perform public._check_referral(u);
  return json_build_object('counted', true, 'points', pts);
end $$;

-- আমার রেফার
create or replace function public.my_referrals() returns json
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public._active_user(); r json;
begin
  select json_build_object(
    'code', (select user_no from profiles where id = u),
    'total', (select count(*) from profiles where referred_by = u),
    'qualified', (select count(*) from profiles where referred_by = u and referral_qualified_at is not null),
    'earned_paisa', (select coalesce(sum(amount),0) from transactions where user_id = u and type in ('referral_bonus','referral_tier_bonus')),
    'min_views', public.setting_int('referral_min_views'),
    'list', coalesce((select json_agg(x order by x.created_at desc) from (
        select p.username, p.created_at, p.referral_qualified_at is not null as qualified,
               (select count(*) from video_views vv where vv.viewer_id = p.id) as views
        from profiles p where p.referred_by = u order by p.created_at desc limit 100) x), '[]'::json),
    'tiers', coalesce((select json_agg(json_build_object('referrals', t.referrals, 'bonus_paisa', t.bonus_paisa,
              'awarded', exists (select 1 from referral_tier_awards a where a.user_id = u and a.tier_id = t.id)) order by t.referrals)
              from referral_tiers t where t.is_active), '[]'::json)
  ) into r;
  return r;
end $$;

-- লোকেশন (শুধু দেশ/শহর ও আনুমানিক জায়গা, ~১ কিমি)
create or replace function public.update_location(p_lat numeric, p_lon numeric, p_country text, p_country_code text, p_city text)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  update user_private set last_lat = round(p_lat, 2), last_lon = round(p_lon, 2), country = left(p_country, 60),
         country_code = upper(left(p_country_code, 2)), city = left(p_city, 80), location_at = now(), last_seen = now()
   where user_id = u;
  update profiles set country_code = upper(left(p_country_code, 2)) where id = u and p_country_code is not null;
end $$;

create or replace function public.set_birth_date(p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  if p_date is not null and (p_date > current_date - interval '10 years' or p_date < date '1920-01-01') then raise exception 'BAD_DATE'; end if;
  update user_private set birth_date = p_date where user_id = u;
end $$;

create or replace function public.touch_last_seen() returns void
language sql security definer set search_path = public as $$
  update user_private set last_seen = now() where user_id = auth.uid();
$$;

-- ফিড: ক্যাটাগরি সহ
drop function if exists public.feed(text, bigint, int, uuid);
create function public.feed(p_type text default 'foryou', p_before bigint default null,
                            p_limit int default 10, p_user uuid default null, p_category text default null)
returns table (id bigint, user_id uuid, username text, full_name text, avatar_url text, is_verified boolean,
               caption text, video_url text, thumb_url text, views_count bigint, likes_count int,
               comments_count int, shares_count int, gifts_coins_total bigint, allow_comments boolean,
               allow_gifts boolean, is_featured boolean, created_at timestamptz,
               liked_by_me boolean, following boolean, category text)
language sql stable security definer set search_path = public as $$
  select v.id, v.user_id, p.username, p.full_name, p.avatar_url, p.is_verified,
         v.caption, v.video_url, v.thumb_url, v.views_count, v.likes_count,
         v.comments_count, v.shares_count, v.gifts_coins_total, v.allow_comments,
         v.allow_gifts, v.is_featured, v.created_at,
         exists (select 1 from likes l where l.video_id = v.id and l.user_id = auth.uid()),
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = v.user_id),
         v.category
  from videos v join profiles p on p.id = v.user_id
  where v.status = 'published' and p.status = 'active'
    and (p_before is null or v.id < p_before)
    and (p_user is null or v.user_id = p_user)
    and (p_category is null or p_category = '' or v.category = p_category)
    and (p_type <> 'following' or exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = v.user_id))
  order by v.id desc
  limit least(greatest(p_limit, 1), 30);
$$;

create or replace function public.set_video_category(p_id bigint, p_category text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  update videos set category = p_category where id = p_id and (user_id = u or public.is_admin());
end $$;

-- অ্যাডমিন: ID নম্বর দিয়ে ইউজারের সব তথ্য
create or replace function public.admin_user_detail(p_user_no bigint) returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid; r json;
begin
  perform public._require_admin();
  select id into uid from profiles where user_no = p_user_no;
  if uid is null then raise exception 'USER_NOT_FOUND'; end if;
  select json_build_object(
    'profile', (select row_to_json(p) from profiles p where p.id = uid),
    'private', (select json_build_object('phone', up.phone, 'email', up.email, 'birth_date', up.birth_date, 'country', up.country,
                  'country_code', up.country_code, 'city', up.city, 'lat', up.last_lat, 'lon', up.last_lon,
                  'location_at', up.location_at, 'last_seen', up.last_seen) from user_private up where up.user_id = uid),
    'wallet', (select row_to_json(w) from wallets w where w.user_id = uid),
    'referred_by', (select json_build_object('user_no', r2.user_no, 'username', r2.username) from profiles p join profiles r2 on r2.id = p.referred_by where p.id = uid),
    'referrals_total', (select count(*) from profiles where referred_by = uid),
    'referrals_qualified', (select count(*) from profiles where referred_by = uid and referral_qualified_at is not null),
    'views_given', (select count(*) from video_views where viewer_id = uid),
    'gifts_sent_coins', (select coalesce(sum(total_coins),0) from gift_transactions where sender_id = uid),
    'gifts_received_paisa', (select coalesce(sum(creator_amount_paisa),0) from gift_transactions where receiver_id = uid),
    'vault_files', (select count(*) from vault_files where user_id = uid),
    'vault_bytes', public.vault_used(uid),
    'videos', coalesce((select json_agg(json_build_object('id', v.id, 'thumb_url', v.thumb_url, 'video_url', v.video_url, 'caption', v.caption,
                  'status', v.status, 'category', v.category, 'views', v.views_count, 'likes', v.likes_count, 'created_at', v.created_at) order by v.id desc)
                  from videos v where v.user_id = uid), '[]'::json)
  ) into r;
  return r;
end $$;

revoke execute on function public.my_referrals(), public.update_location(numeric,numeric,text,text,text), public.set_birth_date(date),
  public.touch_last_seen(), public.feed(text,bigint,int,uuid,text), public.set_video_category(bigint,text),
  public.admin_user_detail(bigint) from public, anon;
grant execute on function public.my_referrals(), public.update_location(numeric,numeric,text,text,text), public.set_birth_date(date),
  public.touch_last_seen(), public.feed(text,bigint,int,uuid,text), public.set_video_category(bigint,text),
  public.admin_user_detail(bigint) to authenticated;
