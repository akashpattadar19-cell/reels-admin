-- 040: আয় বাড়ানো ও নিরাপদ পেমেন্ট — রিওয়ার্ড পুল, VIP, প্রোফাইল সাজানো (ফ্রেম/এন্ট্রি/চ্যাট বাবল), ভিডিও বুস্ট, স্পন্সর ব্যানার

-------------------------------------------------- settings
insert into settings (key, value, description) values
  ('pool_enabled', 'false'::jsonb, 'রিওয়ার্ড পুল চালু (চালু থাকলে পয়েন্ট→টাকা রূপান্তর বন্ধ, পুল থেকে ভাগ পায়)'),
  ('pool_pct', '30'::jsonb, 'প্রতিদিনের কয়েন বিক্রির কত % পুলে যাবে'),
  ('pool_user_cap_paisa', '5000'::jsonb, 'একজন দিনে পুল থেকে সর্বোচ্চ কত (পয়সা, ০ = সীমা নেই)'),
  ('pool_min_points', '50'::jsonb, 'পুলের ভাগ পেতে দিনে কমপক্ষে কত পয়েন্ট'),
  ('play_net_pct', '85'::jsonb, 'Google Play কেনার কত % আপনার হাতে আসে (ফি বাদে)'),
  ('boost_enabled', 'true'::jsonb, 'ভিডিও বুস্ট চালু'),
  ('boost_coins_per_day', '100'::jsonb, 'ভিডিও বুস্ট: প্রতিদিন কত কয়েন'),
  ('boost_max_days', '7'::jsonb, 'ভিডিও বুস্ট: সর্বোচ্চ কত দিন'),
  ('boost_every_n', '4'::jsonb, 'রিলে প্রতি কয়টি ভিডিওর পর ১টি বুস্ট ভিডিও'),
  ('sponsor_every_n', '8'::jsonb, 'রিলে প্রতি কয়টি ভিডিওর পর ১টি স্পন্সর'),
  ('vip_enabled', 'true'::jsonb, 'VIP মেম্বারশিপ চালু'),
  ('store_enabled', 'true'::jsonb, 'প্রোফাইল সাজানোর দোকান চালু')
on conflict (key) do nothing;

-------------------------------------------------- রিওয়ার্ড পুল
create table if not exists public.reward_pools (
  day date primary key,
  revenue_paisa bigint not null default 0,
  pct int not null default 0,
  extra_paisa bigint not null default 0,
  pool_paisa bigint not null default 0,
  total_points bigint not null default 0,
  users int not null default 0,
  paid_paisa bigint not null default 0,
  settled_at timestamptz
);
alter table public.reward_pools enable row level security;
drop policy if exists reward_pools_read on public.reward_pools;
create policy reward_pools_read on public.reward_pools for select to authenticated using (true);

-- একদিনের আসল আয় (নতুন টাকা): অনুমোদিত ক্যাশ-ইন + Google Play কেনা (ফি বাদে)
create or replace function public._pool_revenue(p_day date)
returns bigint language sql stable security definer set search_path to 'public' as $$
  select coalesce((select sum(amount_paisa) from cash_in_requests where status = 'approved'
                    and (reviewed_at at time zone 'Asia/Dhaka')::date = p_day), 0)
       + coalesce((select floor(sum(coins)::numeric * setting_int('coin_price_paisa') * setting_int('play_net_pct') / 100)
                    from play_purchases where status = 'granted' and (created_at at time zone 'Asia/Dhaka')::date = p_day), 0)::bigint;
$$;
revoke execute on function public._pool_revenue(date) from public, anon, authenticated;

-- আজকের অবস্থা (অ্যাপে দেখায়): এখন পর্যন্ত পুল, আমার পয়েন্ট, আনুমানিক ভাগ
create or replace function public.pool_today()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare d date := today_bd(); rev bigint; ext bigint; pool bigint; tot bigint; mine bigint; est bigint; cap bigint := setting_int('pool_user_cap_paisa');
begin
  rev := _pool_revenue(d);
  select coalesce(extra_paisa, 0) into ext from reward_pools where day = d;
  pool := floor(rev * setting_int('pool_pct') / 100.0) + coalesce(ext, 0);
  select coalesce(sum(points), 0) into tot from viewer_daily_points where stat_date = d and points >= setting_int('pool_min_points');
  select coalesce(points, 0) into mine from viewer_daily_points where stat_date = d and user_id = auth.uid();
  mine := coalesce(mine, 0);
  est := case when tot > 0 and mine >= setting_int('pool_min_points') then floor(pool * mine / tot::numeric) else 0 end;
  if cap > 0 then est := least(est, cap); end if;
  return jsonb_build_object('enabled', setting_text('pool_enabled') = 'true', 'pool_paisa', pool, 'my_points', mine, 'total_points', tot,
    'my_est_paisa', est, 'min_points', setting_int('pool_min_points'),
    'yesterday', (select to_jsonb(r) from reward_pools r where day = d - 1));
end $$;
revoke execute on function public.pool_today() from public, anon;
grant execute on function public.pool_today() to authenticated;

-- দিন শেষে ভাগ (BD সময় রাত ১২:১০ এ আগের দিনের)
create or replace function public.pool_settle(p_day date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d date := coalesce(p_day, today_bd() - 1); rev bigint; ext bigint; pool bigint; tot bigint; r record; amt bigint; paid bigint := 0; n int := 0;
  cap bigint := setting_int('pool_user_cap_paisa'); minp int := setting_int('pool_min_points');
  hold interval := make_interval(hours => setting_int('pending_hold_hours')::int);
begin
  if setting_text('pool_enabled') <> 'true' then return jsonb_build_object('skipped', 'disabled'); end if;
  if exists (select 1 from reward_pools where day = d and settled_at is not null) then return jsonb_build_object('skipped', 'done'); end if;
  rev := _pool_revenue(d);
  select coalesce(extra_paisa, 0) into ext from reward_pools where day = d;
  pool := floor(rev * setting_int('pool_pct') / 100.0) + coalesce(ext, 0);
  select coalesce(sum(points), 0) into tot from viewer_daily_points where stat_date = d and points >= minp;
  if pool > 0 and tot > 0 then
    for r in select user_id, points from viewer_daily_points where stat_date = d and points >= minp loop
      amt := floor(pool * r.points / tot::numeric);
      if cap > 0 then amt := least(amt, cap); end if;
      if amt > 0 and exists (select 1 from profiles where id = r.user_id and status = 'active') then
        perform _wallet_move(r.user_id, 'pending', amt, 'reward_pool', 'pool', null, d::text || ' রিওয়ার্ড পুল', 'pool:' || d || ':' || r.user_id, now() + hold);
        perform _notify(r.user_id, 'system', '💰 রিওয়ার্ড পুল থেকে আয়', 'গতকালের পুল থেকে পেয়েছেন ৳' || round(amt / 100.0, 2), '{}'::jsonb);
        paid := paid + amt; n := n + 1;
      end if;
    end loop;
  end if;
  insert into reward_pools (day, revenue_paisa, pct, extra_paisa, pool_paisa, total_points, users, paid_paisa, settled_at)
  values (d, rev, setting_int('pool_pct'), coalesce(ext, 0), pool, tot, n, paid, now())
  on conflict (day) do update set revenue_paisa = excluded.revenue_paisa, pct = excluded.pct, pool_paisa = excluded.pool_paisa,
    total_points = excluded.total_points, users = excluded.users, paid_paisa = excluded.paid_paisa, settled_at = now();
  return jsonb_build_object('day', d, 'pool', pool, 'paid', paid, 'users', n);
end $$;
revoke execute on function public.pool_settle(date) from public, anon, authenticated;
select cron.unschedule('pool-settle') where exists (select 1 from cron.job where jobname = 'pool-settle');
select cron.schedule('pool-settle', '10 18 * * *', 'select public.pool_settle()');  -- ১৮:১০ UTC = বাংলাদেশ রাত ১২:১০

-- এডমিন: আজকের পুলে বাড়তি টাকা (অ্যাড/স্পন্সর আয়) যোগ
create or replace function public.admin_pool_extra(p_day date, p_paisa bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform _require_admin();
  if p_paisa < 0 then raise exception 'BAD_INPUT'; end if;
  if exists (select 1 from reward_pools where day = p_day and settled_at is not null) then raise exception 'POOL_SETTLED'; end if;
  insert into reward_pools (day, extra_paisa) values (p_day, p_paisa) on conflict (day) do update set extra_paisa = p_paisa;
  perform _audit('pool_extra', 'reward_pool', p_day::text, null, jsonb_build_object('paisa', p_paisa));
end $$;
revoke execute on function public.admin_pool_extra(date, bigint) from public, anon;
grant execute on function public.admin_pool_extra(date, bigint) to authenticated;

-- পুল চালু থাকলে পয়েন্ট→টাকা রূপান্তর বন্ধ (দুবার পেমেন্ট এড়াতে)
create or replace function public.convert_points(p_points bigint)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare u uuid := public._active_user(); w record; paisa bigint;
begin
  if public.setting_text('pool_enabled') = 'true' then raise exception 'POOL_MODE'; end if;
  if p_points < public.setting_int('points_convert_min') then raise exception 'BELOW_MIN'; end if;
  select * into w from wallets where user_id = u for update;
  if w.points < p_points then raise exception 'INSUFFICIENT_POINTS'; end if;
  paisa := p_points * public.setting_int('point_value_paisa');
  perform public._wallet_move(u, 'points', -p_points, 'points_convert', null, null, p_points || ' পয়েন্ট → ৳' || round(paisa/100.0,2));
  perform public._wallet_move(u, 'earning', paisa, 'points_convert', null, null, p_points || ' পয়েন্ট থেকে');
  return json_build_object('ok', true, 'paisa', paisa);
end $function$;

-------------------------------------------------- VIP
create table if not exists public.vip_plans (
  id serial primary key,
  name text not null,
  days int not null check (days > 0),
  price_coins int not null check (price_coins > 0),
  daily_coins int not null default 0,
  points_bonus_pct int not null default 0,
  badge text not null default '💎',
  color text not null default 'gold',
  active boolean not null default true,
  sort int not null default 0
);
alter table public.vip_plans enable row level security;
drop policy if exists vip_plans_read on public.vip_plans;
create policy vip_plans_read on public.vip_plans for select to authenticated using (active or is_admin());
alter table public.profiles add column if not exists vip_until timestamptz, add column if not exists vip_plan_id int,
  add column if not exists vip_claimed_on date, add column if not exists deco jsonb not null default '{}'::jsonb;

insert into vip_plans (name, days, price_coins, daily_coins, points_bonus_pct, badge, color, sort)
select * from (values ('VIP', 30, 3000, 20, 20, '💎', 'gold', 1), ('SVIP', 30, 8000, 60, 50, '👑', 'purple', 2)) v
where not exists (select 1 from vip_plans);

create or replace function public.buy_vip(p_plan int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u uuid := _active_user(); pl record; w record; nu timestamptz;
begin
  if setting_text('vip_enabled') <> 'true' then raise exception 'VIP_OFF'; end if;
  select * into pl from vip_plans where id = p_plan and active;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into w from wallets where user_id = u for update;
  if w.coin_balance < pl.price_coins then raise exception 'INSUFFICIENT_COINS'; end if;
  perform _wallet_move(u, 'coin', -pl.price_coins, 'vip_purchase', 'vip', pl.id, pl.name || ' ' || pl.days || ' দিন', null);
  -- একই প্ল্যান হলে মেয়াদ বাড়ে, অন্য প্ল্যানে বদলালে আজ থেকে নতুন মেয়াদ
  select case when vip_plan_id = pl.id and vip_until > now() then vip_until else now() end + make_interval(days => pl.days)
    into nu from profiles where id = u;
  update profiles set vip_until = nu, vip_plan_id = pl.id where id = u;
  return jsonb_build_object('ok', true, 'vip_until', nu, 'plan', pl.name);
end $$;

create or replace function public.claim_vip_daily()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u uuid := _active_user(); p record; pl record;
begin
  select * into p from profiles where id = u for update;
  if p.vip_until is null or p.vip_until < now() then raise exception 'NOT_VIP'; end if;
  if p.vip_claimed_on = today_bd() then raise exception 'ALREADY_CLAIMED'; end if;
  select * into pl from vip_plans where id = p.vip_plan_id;
  if coalesce(pl.daily_coins, 0) <= 0 then raise exception 'NOT_FOUND'; end if;
  update profiles set vip_claimed_on = today_bd() where id = u;
  perform _wallet_move(u, 'coin', pl.daily_coins, 'vip_daily', 'vip', pl.id, null, 'vipd:' || u || ':' || today_bd());
  return jsonb_build_object('ok', true, 'coins', pl.daily_coins);
end $$;

create or replace function public._vip_bonus_pct(p_user uuid)
returns int language sql stable security definer set search_path to 'public' as $$
  select coalesce((select vp.points_bonus_pct from profiles p join vip_plans vp on vp.id = p.vip_plan_id
                   where p.id = p_user and p.vip_until > now()), 0);
$$;

-- পুরো ভিডিও দেখার পয়েন্টে VIP বোনাস
create or replace function public.claim_watch_reward(p_video_id bigint, p_watch_ms integer)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare u uuid := public._active_user(); d date := public.today_bd(); vv record; dur_ms int; need_ms int;
  pct int := coalesce(nullif(public.setting_int('watch_full_pct'), 0), 95); pts int; cap int; got int;
begin
  if public.setting_text('earnings_enabled') <> 'true' then return json_build_object('ok', false, 'points', 0); end if;
  select w.id, w.created_at, w.rewarded_at, w.watch_ms, coalesce(vd.duration_sec, 0) as dur
    into vv from video_views w join videos vd on vd.id = w.video_id
    where w.video_id = p_video_id and w.viewer_id = u and w.view_date = d for update of w;
  if not found then return json_build_object('ok', false, 'reason', 'no_view'); end if;
  if vv.rewarded_at is not null then return json_build_object('ok', false, 'reason', 'dup'); end if;
  dur_ms := greatest(vv.dur, 1) * 1000;
  need_ms := ceil(dur_ms * pct / 100.0);
  if p_watch_ms < need_ms then return json_build_object('ok', false, 'reason', 'not_full'); end if;
  if extract(epoch from (now() - vv.created_at)) * 1000 < (need_ms - public.setting_int('min_watch_ms')) * 0.8 then
    return json_build_object('ok', false, 'reason', 'too_fast');
  end if;
  update video_views set rewarded_at = now(), watch_ms = least(greatest(watch_ms, p_watch_ms), 600000) where id = vv.id;
  pts := public.setting_int('watch_points');
  pts := pts + floor(pts * public._vip_bonus_pct(u) / 100.0)::int;
  cap := public.setting_int('viewer_daily_points_cap');
  insert into viewer_daily_points (user_id, stat_date) values (u, d) on conflict do nothing;
  select points into got from viewer_daily_points where user_id = u and stat_date = d for update;
  pts := greatest(least(pts, cap - got), 0);
  if pts > 0 then
    update viewer_daily_points set points = points + pts where user_id = u and stat_date = d;
    perform public._wallet_move(u, 'points', pts, 'watch_reward', 'video', p_video_id, null, 'watch:' || u || ':' || p_video_id || ':' || d);
  end if;
  return json_build_object('ok', true, 'points', pts, 'capped', pts = 0);
end $function$;

-------------------------------------------------- দোকান: ফ্রেম / এন্ট্রি / চ্যাট বাবল
create table if not exists public.store_items (
  id serial primary key,
  kind text not null check (kind in ('frame','entry','bubble')),
  style text not null,               -- অ্যাপে আগে থেকে বানানো ডিজাইনের নাম (gold, rainbow, fire …)
  name text not null,
  price_coins int not null check (price_coins >= 0),
  days int not null default 30,      -- ০ = সারাজীবন
  vip_only boolean not null default false,
  active boolean not null default true,
  sort int not null default 0
);
alter table public.store_items enable row level security;
drop policy if exists store_items_read on public.store_items;
create policy store_items_read on public.store_items for select to authenticated using (active or is_admin());

create table if not exists public.user_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id int not null references public.store_items(id),
  expires_at timestamptz,
  bought_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.user_items enable row level security;
drop policy if exists user_items_read on public.user_items;
create policy user_items_read on public.user_items for select to authenticated using (user_id = auth.uid() or is_admin());

insert into store_items (kind, style, name, price_coins, days, sort)
select * from (values
  ('frame','gold','সোনালি ফ্রেম',500,30,1), ('frame','rainbow','রংধনু ফ্রেম',800,30,2), ('frame','neon','নিয়ন ফ্রেম',800,30,3),
  ('frame','flower','ফুলের ফ্রেম',600,30,4), ('frame','fire','আগুন ফ্রেম',1200,30,5), ('frame','crown','মুকুট ফ্রেম',2000,30,6),
  ('entry','stars','তারার এন্ট্রি',800,30,1), ('entry','fire','আগুনের এন্ট্রি',1200,30,2), ('entry','royal','রাজকীয় এন্ট্রি',2500,30,3), ('entry','rocket','রকেট এন্ট্রি',1500,30,4),
  ('bubble','pink','গোলাপি বাবল',300,30,1), ('bubble','ocean','সাগর বাবল',300,30,2), ('bubble','gold','সোনালি বাবল',600,30,3), ('bubble','night','রাতের বাবল',400,30,4)
) v where not exists (select 1 from store_items);

create or replace function public.buy_item(p_item int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u uuid := _active_user(); it record; w record; cur timestamptz; owned boolean; nu timestamptz;
begin
  if setting_text('store_enabled') <> 'true' then raise exception 'STORE_OFF'; end if;
  select * into it from store_items where id = p_item and active;
  if not found then raise exception 'NOT_FOUND'; end if;
  if it.vip_only and not exists (select 1 from profiles where id = u and vip_until > now()) then raise exception 'NOT_VIP'; end if;
  select true, expires_at into owned, cur from user_items where user_id = u and item_id = it.id;
  if owned and cur is null then raise exception 'ALREADY_OWNED'; end if;
  select * into w from wallets where user_id = u for update;
  if w.coin_balance < it.price_coins then raise exception 'INSUFFICIENT_COINS'; end if;
  if it.price_coins > 0 then
    perform _wallet_move(u, 'coin', -it.price_coins, 'store_purchase', 'item', it.id, it.name, null);
  end if;
  nu := case when it.days = 0 then null else greatest(coalesce(cur, now()), now()) + make_interval(days => it.days) end;
  insert into user_items (user_id, item_id, expires_at) values (u, it.id, nu)
    on conflict (user_id, item_id) do update set expires_at = excluded.expires_at, bought_at = now();
  update profiles set deco = deco || jsonb_build_object(it.kind, it.style) where id = u;   -- কিনলেই পরানো
  return jsonb_build_object('ok', true, 'expires_at', nu);
end $$;

create or replace function public.equip_item(p_kind text, p_item int)
returns void language plpgsql security definer set search_path to 'public' as $$
declare u uuid := _active_user(); st text;
begin
  if p_kind not in ('frame','entry','bubble') then raise exception 'BAD_INPUT'; end if;
  if p_item is null then update profiles set deco = deco - p_kind where id = u; return; end if;
  select s.style into st from user_items ui join store_items s on s.id = ui.item_id
   where ui.user_id = u and ui.item_id = p_item and s.kind = p_kind and (ui.expires_at is null or ui.expires_at > now());
  if st is null then raise exception 'NOT_FOUND'; end if;
  update profiles set deco = deco || jsonb_build_object(p_kind, st) where id = u;
end $$;

-- মেয়াদ শেষ হলে খুলে ফেলা (প্রতি ঘণ্টা)
create or replace function public.deco_expire()
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int := 0; r record;
begin
  for r in select p.id, k.key as kind, k.value #>> '{}' as style from profiles p, jsonb_each(p.deco) k loop
    if not exists (select 1 from user_items ui join store_items s on s.id = ui.item_id
                   where ui.user_id = r.id and s.kind = r.kind and s.style = r.style and (ui.expires_at is null or ui.expires_at > now())) then
      update profiles set deco = deco - r.kind where id = r.id; n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.deco_expire() from public, anon, authenticated;
select cron.unschedule('deco-expire') where exists (select 1 from cron.job where jobname = 'deco-expire');
select cron.schedule('deco-expire', '7 * * * *', 'select public.deco_expire()');

-- লাইভে ঢুকলে এন্ট্রি ইফেক্ট: join মেসেজের body-তে স্টাইল + VIP
create or replace function public.live_join(p_room bigint)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare u uuid := auth.uid(); r record; me record; isnew boolean; body text;
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  select * into r from live_rooms where id = p_room;
  if not found or r.status <> 'live' then raise exception 'LIVE_ENDED'; end if;
  if r.host_id <> u then
    insert into live_viewers (room_id, user_id) values (p_room, u) on conflict (room_id, user_id) do update set last_seen = now()
      returning (xmax = 0) into isnew;
    if isnew then
      update live_rooms set total_viewers = total_viewers + 1 where id = p_room;
      select username, deco, vip_until into me from profiles where id = u;
      body := case when me.deco ? 'entry' then 'fx:' || (me.deco->>'entry') || case when me.vip_until > now() then ':vip' else '' end
                   when me.vip_until > now() then 'fx:vip:vip' else 'যোগ দিয়েছে' end;
      insert into live_messages (room_id, user_id, username, kind, body) values (p_room, u, me.username, 'join', body);
    end if;
  end if;
  return json_build_object('room_id', r.id, 'channel', 'live_' || r.id, 'host_id', r.host_id, 'title', r.title, 'started_at', r.started_at,
    'viewers', public._live_viewers_now(p_room), 'likes', r.likes, 'gift_coins', r.gift_coins);
end $function$;

-------------------------------------------------- ভিডিও বুস্ট
alter table public.videos add column if not exists boost_until timestamptz, add column if not exists boost_coins int not null default 0;
create index if not exists videos_boost on public.videos(boost_until) where boost_until is not null;

create or replace function public.boost_video(p_video bigint, p_days int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u uuid := _active_user(); v record; cost int; w record; nu timestamptz;
begin
  if setting_text('boost_enabled') <> 'true' then raise exception 'BOOST_OFF'; end if;
  if p_days < 1 or p_days > greatest(setting_int('boost_max_days'), 1) then raise exception 'BAD_INPUT'; end if;
  select * into v from videos where id = p_video for update;
  if not found or v.user_id <> u then raise exception 'NOT_FOUND'; end if;
  if v.status <> 'published' then raise exception 'NOT_PUBLISHED'; end if;
  cost := p_days * setting_int('boost_coins_per_day');
  select * into w from wallets where user_id = u for update;
  if w.coin_balance < cost then raise exception 'INSUFFICIENT_COINS'; end if;
  perform _wallet_move(u, 'coin', -cost, 'video_boost', 'video', p_video, p_days || ' দিন বুস্ট', null);
  nu := greatest(coalesce(v.boost_until, now()), now()) + make_interval(days => p_days);
  update videos set boost_until = nu, boost_coins = boost_coins + cost where id = p_video;
  return jsonb_build_object('ok', true, 'boost_until', nu);
end $$;

create or replace function public.boosted_feed(p_limit int default 5)
returns table(id bigint, user_id uuid, username text, full_name text, avatar_url text, is_verified boolean, caption text, video_url text, thumb_url text,
  views_count bigint, likes_count integer, comments_count integer, shares_count integer, gifts_coins_total bigint, allow_comments boolean, allow_gifts boolean,
  is_featured boolean, created_at timestamptz, liked_by_me boolean, following boolean, category text, country_code text, language text, level integer,
  account_type text, is_premium boolean, premium_coins integer, locked boolean, frame text)
language sql stable security definer set search_path to 'public' as $$
  select v.id, v.user_id, p.username, p.full_name, p.avatar_url, p.is_verified, v.caption, v.video_url, v.thumb_url, v.views_count, v.likes_count,
         v.comments_count, v.shares_count, v.gifts_coins_total, v.allow_comments, v.allow_gifts, v.is_featured, v.created_at,
         exists (select 1 from likes l where l.video_id = v.id and l.user_id = auth.uid()),
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = v.user_id),
         v.category, p.country_code, p.language, public._level(p.followers_count), p.account_type, v.is_premium, v.premium_coins, false, v.frame
  from videos v join profiles p on p.id = v.user_id
  where v.status = 'published' and p.status = 'active' and v.boost_until > now() and not v.is_premium and v.user_id <> coalesce(auth.uid(), v.user_id)
  order by random() limit least(greatest(p_limit, 1), 20);
$$;
revoke execute on function public.boosted_feed(int) from public, anon;
grant execute on function public.boosted_feed(int) to authenticated;

-------------------------------------------------- স্পন্সর ব্যানার
create table if not exists public.sponsor_ads (
  id serial primary key,
  title text not null,
  image_url text not null,
  link_url text,
  placement text not null default 'all' check (placement in ('all','home','feed')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  price_note text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.sponsor_ads enable row level security;
drop policy if exists sponsor_read on public.sponsor_ads;
create policy sponsor_read on public.sponsor_ads for select to authenticated
  using (is_admin() or (active and starts_at <= now() and (ends_at is null or ends_at > now())));

create or replace function public.sponsor_event(p_id int, p_kind text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return; end if;
  if p_kind = 'click' then update sponsor_ads set clicks = clicks + 1 where id = p_id;
  else update sponsor_ads set impressions = impressions + 1 where id = p_id; end if;
end $$;

create or replace function public.admin_save_sponsor(p_id int, p_title text, p_image text, p_link text, p_place text,
  p_starts timestamptz, p_ends timestamptz, p_active boolean, p_note text, p_sort int)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  perform _require_admin();
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_image), '') = '' then raise exception 'BAD_INPUT'; end if;
  if p_link is not null and p_link <> '' and p_link !~* '^(https?://|#)' then raise exception 'BAD_LINK'; end if;
  if p_id is null then
    insert into sponsor_ads (title, image_url, link_url, placement, starts_at, ends_at, active, price_note, sort)
    values (p_title, p_image, nullif(p_link, ''), coalesce(p_place, 'all'), coalesce(p_starts, now()), p_ends, coalesce(p_active, true), p_note, coalesce(p_sort, 0))
    returning id into v;
  else
    update sponsor_ads set title = p_title, image_url = p_image, link_url = nullif(p_link, ''), placement = coalesce(p_place, 'all'),
      starts_at = coalesce(p_starts, starts_at), ends_at = p_ends, active = coalesce(p_active, true), price_note = p_note, sort = coalesce(p_sort, 0)
    where id = p_id returning id into v;
  end if;
  return v;
end $$;

create or replace function public.admin_delete_sponsor(p_id int)
returns void language plpgsql security definer set search_path to 'public' as $$
begin perform _require_admin(); delete from sponsor_ads where id = p_id; end $$;

-------------------------------------------------- এডমিন: VIP প্ল্যান ও দোকানের জিনিস
create or replace function public.admin_save_vip_plan(p_id int, p_name text, p_days int, p_price int, p_daily int, p_bonus int, p_badge text, p_color text, p_active boolean, p_sort int)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  perform _require_admin();
  if coalesce(trim(p_name), '') = '' or p_days < 1 or p_price < 1 or p_daily < 0 or p_bonus < 0 then raise exception 'BAD_INPUT'; end if;
  if p_id is null then
    insert into vip_plans (name, days, price_coins, daily_coins, points_bonus_pct, badge, color, active, sort)
    values (p_name, p_days, p_price, p_daily, p_bonus, coalesce(nullif(p_badge, ''), '💎'), coalesce(nullif(p_color, ''), 'gold'), coalesce(p_active, true), coalesce(p_sort, 0)) returning id into v;
  else
    update vip_plans set name = p_name, days = p_days, price_coins = p_price, daily_coins = p_daily, points_bonus_pct = p_bonus,
      badge = coalesce(nullif(p_badge, ''), '💎'), color = coalesce(nullif(p_color, ''), 'gold'), active = coalesce(p_active, true), sort = coalesce(p_sort, 0)
    where id = p_id returning id into v;
  end if;
  return v;
end $$;

create or replace function public.admin_save_store_item(p_id int, p_kind text, p_style text, p_name text, p_price int, p_days int, p_vip boolean, p_active boolean, p_sort int)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  perform _require_admin();
  if p_kind not in ('frame','entry','bubble') or coalesce(trim(p_style), '') = '' or coalesce(trim(p_name), '') = '' or p_price < 0 or p_days < 0 then raise exception 'BAD_INPUT'; end if;
  if p_id is null then
    insert into store_items (kind, style, name, price_coins, days, vip_only, active, sort)
    values (p_kind, p_style, p_name, p_price, p_days, coalesce(p_vip, false), coalesce(p_active, true), coalesce(p_sort, 0)) returning id into v;
  else
    update store_items set kind = p_kind, style = p_style, name = p_name, price_coins = p_price, days = p_days, vip_only = coalesce(p_vip, false),
      active = coalesce(p_active, true), sort = coalesce(p_sort, 0) where id = p_id returning id into v;
  end if;
  return v;
end $$;

create or replace function public.admin_monetize_stats(p_days int default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  perform _require_admin();
  return jsonb_build_object(
    'vip_active', (select count(*) from profiles where vip_until > now()),
    'vip_coins', (select coalesce(-sum(amount), 0) from transactions where type = 'vip_purchase' and created_at > since),
    'store_coins', (select coalesce(-sum(amount), 0) from transactions where type = 'store_purchase' and created_at > since),
    'boost_coins', (select coalesce(-sum(amount), 0) from transactions where type = 'video_boost' and created_at > since),
    'boosted_now', (select count(*) from videos where boost_until > now()),
    'vip_users', coalesce((select jsonb_agg(x) from (select p.user_no, p.username, p.vip_until, vp.name as plan from profiles p
        left join vip_plans vp on vp.id = p.vip_plan_id where p.vip_until > now() order by p.vip_until desc limit 50) x), '[]'),
    'boosts', coalesce((select jsonb_agg(x) from (select v.id, v.caption, v.boost_until, v.boost_coins, v.views_count, p.user_no, p.username
        from videos v join profiles p on p.id = v.user_id where v.boost_until > now() - interval '7 days' order by v.boost_until desc limit 50) x), '[]'),
    'pools', coalesce((select jsonb_agg(r order by r.day desc) from (select * from reward_pools order by day desc limit 30) r), '[]'));
end $$;

revoke execute on function public.buy_vip(int), public.claim_vip_daily(), public.buy_item(int), public.equip_item(text, int), public.boost_video(bigint, int),
  public.sponsor_event(int, text), public.admin_save_sponsor(int, text, text, text, text, timestamptz, timestamptz, boolean, text, int), public.admin_delete_sponsor(int),
  public.admin_save_vip_plan(int, text, int, int, int, int, text, text, boolean, int), public.admin_save_store_item(int, text, text, text, int, int, boolean, boolean, int),
  public.admin_monetize_stats(int), public._vip_bonus_pct(uuid) from public, anon;
grant execute on function public.buy_vip(int), public.claim_vip_daily(), public.buy_item(int), public.equip_item(text, int), public.boost_video(bigint, int),
  public.sponsor_event(int, text), public.admin_save_sponsor(int, text, text, text, text, timestamptz, timestamptz, boolean, text, int), public.admin_delete_sponsor(int),
  public.admin_save_vip_plan(int, text, int, int, int, int, text, text, boolean, int), public.admin_save_store_item(int, text, text, text, int, int, boolean, boolean, int),
  public.admin_monetize_stats(int) to authenticated;
revoke execute on function public._vip_bonus_pct(uuid) from authenticated;
