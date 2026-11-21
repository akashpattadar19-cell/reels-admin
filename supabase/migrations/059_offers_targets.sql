-- 059: নতুন অফার — রেফার ৳১০/৳১০ (হোস্ট ৳১০ + নতুন জন ৳১৫, প্রতি ৩ জনে +৳৪০), দৈনিক টার্গেট কয়েন,
-- হোস্টের ভিডিওতে লাইক/কমেন্ট/শেয়ারে কয়েন, ১০ দিনের টপ রেফার বোনাস, উইথড্র ১৫ দিন + এডমিনের দ্রুত উইথড্র,
-- একই মোবাইলের বাড়তি অ্যাকাউন্টের ফ্রি কয়েন দিয়ে গিফট/কল নিষেধ।

-- ===== ফ্রি (বোনাস) কয়েন আলাদা হিসাব =====
alter table wallets add column if not exists bonus_coins bigint not null default 0;
update wallets w set bonus_coins = least(w.coin_balance, coalesce((select sum(amount) from transactions t
  where t.user_id = w.user_id and t.bucket = 'coin' and t.amount > 0
    and t.type in ('checkin_reward','starter_reward','upload_reward','vip_daily','ref_topup_bonus')), 0));

-- এই মোবাইলে প্রথম খোলা অ্যাকাউন্ট কিনা (বাড়তি অ্যাকাউন্ট = false; অ্যাপে লগইন না থাকলে false)
create or replace function public._device_primary(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_devices where user_id = p_user)
     and not exists (select 1 from user_devices mine join user_devices o on o.device_hash = mine.device_hash and o.user_id <> mine.user_id
                     where mine.user_id = p_user and o.first_seen < mine.first_seen);
$$;
revoke all on function public._device_primary(uuid) from public, anon, authenticated;

create or replace function public._wallet_move(p_user uuid, p_bucket text, p_amount bigint, p_type text, p_ref_type text DEFAULT NULL::text, p_ref_id bigint DEFAULT NULL::bigint, p_note text DEFAULT NULL::text, p_idem text DEFAULT NULL::text, p_available_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_by uuid DEFAULT NULL::uuid)
 returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_after bigint; v_earned bigint := 0; v_gross numeric; v_cb bigint; wb record;
begin
  if p_amount = 0 then return null; end if;
  if p_amount > 0 and p_bucket in ('pending', 'earning') and p_type in ('gift_received', 'call_earning')
     and coalesce(public.setting_text('beans_enabled'), 'false') = 'true'
     and (select account_type from profiles where id = p_user) = 'host' then
    v_gross := case p_ref_type
      when 'gift_tx' then (select total_coins from gift_transactions where id = p_ref_id)
      when 'call' then (select rate_coins from calls where id = p_ref_id) end;
    if v_gross is null then v_gross := p_amount::numeric / greatest(public.setting_int('coin_price_paisa'), 1); end if;
    v_cb := floor(v_gross * 100 / greatest(public.setting_int('coins_per_bean'), 1));
    if v_cb <= 0 then return null; end if;
    return public._wallet_move(p_user, 'beans', v_cb, p_type, p_ref_type, p_ref_id, p_note, p_idem, null, p_by);
  end if;
  if p_amount > 0 and public._income_locked(p_type) then
    if p_type = 'points_convert' then raise exception 'INCOME_LOCKED'; end if;
    return null;
  end if;
  if p_idem is not null and exists (select 1 from transactions where idem_key = p_idem) then return null; end if;
  insert into wallets (user_id) values (p_user) on conflict do nothing;
  if p_amount > 0 and p_type in ('view_earning','like_earning','comment_earning','gift_received','points_convert',
                                 'referral_bonus','referral_tier_bonus','post_like_earning','post_comment_earning',
                                 'post_share_earning','contest_prize','season_prize') then
    v_earned := p_amount;
  end if;
  if p_bucket = 'coin' then
    select coin_balance, bonus_coins into wb from wallets where user_id = p_user for update;
    if p_amount > 0 then
      update wallets set coin_balance = coin_balance + p_amount,
        bonus_coins = bonus_coins + case when p_type in ('checkin_reward','starter_reward','upload_reward','vip_daily','ref_topup_bonus',
                                                         'daily_task_reward','host_engage_reward') then p_amount else 0 end,
        updated_at = now() where user_id = p_user returning coin_balance into v_after;
    elsif p_type in ('gift_sent', 'call_charge', 'seller_sale') and not public._device_primary(p_user) then
      -- বাড়তি অ্যাকাউন্ট: ফ্রি কয়েন দিয়ে গিফট/কল নয়, শুধু কেনা কয়েন
      if wb.coin_balance - wb.bonus_coins < -p_amount then raise exception 'BONUS_COINS_GIFT'; end if;
      update wallets set coin_balance = coin_balance + p_amount, updated_at = now() where user_id = p_user returning coin_balance into v_after;
    else
      update wallets set coin_balance = coin_balance + p_amount, bonus_coins = greatest(bonus_coins + p_amount, 0), updated_at = now()
        where user_id = p_user returning coin_balance into v_after;
    end if;
    update wallets set bonus_coins = least(bonus_coins, coin_balance) where user_id = p_user and bonus_coins > coin_balance;
  elsif p_bucket = 'earning' then
    update wallets set earning_paisa = earning_paisa + p_amount, total_earned_paisa = total_earned_paisa + v_earned, updated_at = now()
      where user_id = p_user returning earning_paisa into v_after;
  elsif p_bucket = 'pending' then
    update wallets set pending_paisa = pending_paisa + p_amount, total_earned_paisa = total_earned_paisa + v_earned, updated_at = now()
      where user_id = p_user returning pending_paisa into v_after;
  elsif p_bucket = 'points' then
    update wallets set points = points + p_amount, updated_at = now() where user_id = p_user returning points into v_after;
  elsif p_bucket = 'beans' then
    update wallets set beans = beans + p_amount, updated_at = now() where user_id = p_user returning beans into v_after;
  else
    raise exception 'BAD_BUCKET';
  end if;
  insert into transactions (user_id, type, bucket, amount, balance_after, ref_type, ref_id, note, idem_key, available_at, created_by)
  values (p_user, p_type, p_bucket, p_amount, v_after, p_ref_type, p_ref_id, p_note, p_idem, p_available_at, p_by);
  if p_bucket = 'coin' then
    if p_amount > 0 and p_type in ('cash_in', 'play_purchase', 'seller_buy') then
      update profiles set wealth_topup = wealth_topup + p_amount where id = p_user;
    elsif p_amount < 0 and p_type not in ('seller_sale', 'seller_commission', 'admin_adjust', 'admin_coin_grant') then
      update profiles set wealth_spent = wealth_spent - p_amount where id = p_user;
    end if;
    if p_amount > 0 and p_type in ('cash_in', 'play_purchase') then
      perform public._ref_topup_bonus(p_user, p_amount, coalesce(p_idem, p_type || ':' || coalesce(p_ref_id::text, '')));
    end if;
  end if;
  return v_after;
end $function$;

-- ===== সেটিংস =====
insert into settings(key, value) values
 ('ref_new_user_paisa', '1000'::jsonb),            -- ইউজার রেফার করলে নতুন জন ৳১০
 ('host_ref_new_user_paisa', '1500'::jsonb),       -- হোস্ট রেফার করলে নতুন জন ৳১৫
 ('host_ref_every_n', '3'::jsonb),                 -- হোস্ট প্রতি ৩ সফল রেফারে
 ('host_ref_every_paisa', '4000'::jsonb),          -- বাড়তি ৳৪০
 ('ref_referrer_min_videos', '2'::jsonb),          -- যে রেফার করেছে তারও কমপক্ষে ২ ভিডিও
 ('ref_referrer_min_texts', '2'::jsonb),           -- আর ২ লেখা পোস্ট
 ('daily_task_enabled', 'true'::jsonb),
 ('daily_task_user', '{"watch":8,"like":8,"comment":8,"tlike":8,"tcomment":8,"share":5,"video_post":0,"text_post":0,"coins":800}'::jsonb),
 ('daily_task_host', '{"watch":5,"like":5,"comment":5,"tlike":5,"tcomment":5,"share":5,"video_post":5,"text_post":3,"coins":1100}'::jsonb),
 ('host_engage', '{"enabled":true,"coins":20,"daily_cap":2000}'::jsonb),
 ('ref_top_enabled', 'true'::jsonb),
 ('ref_top_user', '{"top":10,"tiers":[{"refs":25,"active":15,"paisa":15000},{"refs":50,"active":45,"paisa":35000},{"refs":100,"active":65,"paisa":90000}]}'::jsonb),
 ('ref_top_host', '{"top":5,"tiers":[{"refs":25,"active":15,"paisa":15000},{"refs":50,"active":40,"paisa":40000},{"refs":100,"active":60,"paisa":120000}]}'::jsonb),
 ('fast_withdraw_days', '1'::jsonb)
on conflict (key) do nothing;

update settings set value = '1000'::jsonb where key = 'referral_bonus_paisa';
update settings set value = '1000'::jsonb where key = 'host_referral_bonus_paisa';
update settings set value = '0'::jsonb where key in ('referral_welcome_points','ref_req_full_watch','ref_req_likes','ref_req_comments','ref_req_shares','ref_req_active_days');
update settings set value = '2'::jsonb where key in ('ref_req_video_posts','ref_req_text_posts');
update settings set value = '15'::jsonb where key = 'withdraw_cooldown_days';
update settings set value = '[{"refs":0,"days":15}]'::jsonb where key = 'withdraw_levels';
update referral_tiers set is_active = false;

-- ===== দ্রুত উইথড্র (এডমিন যাচাই করে চালু করবেন) =====
alter table profiles add column if not exists fast_withdraw boolean not null default false;
alter table profiles add column if not exists fast_withdraw_at timestamptz;

create or replace function public._withdraw_level(p_user uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare n int; lv jsonb; cur jsonb := null; nxt jsonb := null; x jsonb; fast boolean;
begin
  select coalesce(fast_withdraw, false) into fast from profiles where id = p_user;
  select count(*) into n from profiles where referred_by = p_user and referral_qualified_at is not null;
  if fast then
    return json_build_object('refs', n, 'days', public.setting_int('fast_withdraw_days'), 'fast', true, 'next', null, 'levels', '[]'::json);
  end if;
  select value into lv from settings where key = 'withdraw_levels';
  if lv is null or jsonb_typeof(lv) <> 'array' or jsonb_array_length(lv) = 0 then
    lv := jsonb_build_array(jsonb_build_object('refs', 0, 'days', public.setting_int('withdraw_cooldown_days')));
  end if;
  for x in select e from jsonb_array_elements(lv) e order by (e->>'refs')::int loop
    if (x->>'refs')::int <= n then cur := x; elsif nxt is null then nxt := x; end if;
  end loop;
  if cur is null then cur := jsonb_build_object('refs', 0, 'days', public.setting_int('withdraw_cooldown_days')); end if;
  return json_build_object('refs', n, 'days', (cur->>'days')::numeric, 'fast', false, 'next', nxt, 'levels', lv);
end $$;

create or replace function public.admin_set_fast_withdraw(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update profiles set fast_withdraw = p_on, fast_withdraw_at = case when p_on then now() else null end where id = p_user;
  if p_on then
    perform public._notify(p_user, 'system', '⚡ দ্রুত উইথড্র চালু হয়েছে!', 'আপনার ভালো কাজের জন্য এখন অপেক্ষা ছাড়াই দ্রুত উইথড্র করতে পারবেন, আর আপনার পেমেন্ট আগে যাবে।', '{}'::jsonb);
  end if;
  perform public._audit('fast_withdraw', 'user', p_user::text, null, jsonb_build_object('on', p_on));
end $$;
revoke all on function public.admin_set_fast_withdraw(uuid, boolean) from public, anon;
grant execute on function public.admin_set_fast_withdraw(uuid, boolean) to authenticated;

-- ===== দৈনিক টার্গেট =====
create table if not exists daily_task_claims (
  user_id uuid not null references profiles(id) on delete cascade, day date not null, kind text not null,
  coins int not null, device_hash text, created_at timestamptz not null default now(), primary key (user_id, day));
alter table daily_task_claims enable row level security;
drop policy if exists dtc_own on daily_task_claims;
create policy dtc_own on daily_task_claims for select using (user_id = auth.uid());

create or replace function public._daily_task_items(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := public.today_bd(); host boolean; cfg jsonb; d0 timestamptz; d1 timestamptz; r jsonb := '[]'::jsonb; k text; need int; have int;
begin
  select account_type = 'host' into host from profiles where id = p_user;
  cfg := coalesce((select value from settings where key = case when host then 'daily_task_host' else 'daily_task_user' end), '{}'::jsonb);
  d0 := (d::timestamp at time zone 'Asia/Dhaka'); d1 := d0 + interval '1 day';
  foreach k in array array['video_post','text_post','watch','like','comment','tlike','tcomment','share'] loop
    need := coalesce((cfg->>k)::int, 0);
    if need <= 0 then continue; end if;
    have := case k
      when 'watch' then (select count(*) from video_views w join videos v on v.id = w.video_id where w.viewer_id = p_user and w.view_date = d
                          and w.creator_id <> p_user and (w.rewarded_at is not null or w.watch_ms >= greatest(v.duration_sec, 1) * 950))
      when 'like' then (select count(*) from likes l join videos v on v.id = l.video_id where l.user_id = p_user and v.user_id <> p_user and l.created_at >= d0 and l.created_at < d1)
      when 'comment' then (select count(distinct c.video_id) from comments c join videos v on v.id = c.video_id where c.user_id = p_user and v.user_id <> p_user
                            and coalesce(c.status, 'visible') <> 'deleted' and c.created_at >= d0 and c.created_at < d1)
      when 'tlike' then (select count(*) from post_likes l join posts p on p.id = l.post_id where l.user_id = p_user and p.kind = 'text' and p.user_id <> p_user and l.created_at >= d0 and l.created_at < d1)
      when 'tcomment' then (select count(distinct c.post_id) from post_comments c join posts p on p.id = c.post_id where c.user_id = p_user and p.kind = 'text' and p.user_id <> p_user and c.created_at >= d0 and c.created_at < d1)
      when 'share' then (select count(*) from shares where user_id = p_user and created_at >= d0 and created_at < d1)
                      + (select count(*) from post_shares where user_id = p_user and created_at >= d0 and created_at < d1)
      when 'video_post' then (select count(*) from videos where user_id = p_user and status <> 'rejected' and created_at >= d0 and created_at < d1)
      when 'text_post' then (select count(*) from posts where user_id = p_user and kind = 'text' and status <> 'rejected' and created_at >= d0 and created_at < d1)
    end;
    r := r || jsonb_build_object('k', k, 'need', need, 'have', least(have, need));
  end loop;
  return jsonb_build_object('host', host, 'coins', coalesce((cfg->>'coins')::int, 0), 'items', r,
    'done', jsonb_array_length(r) > 0 and not exists (select 1 from jsonb_array_elements(r) x where (x->>'have')::int < (x->>'need')::int),
    'claimed', exists (select 1 from daily_task_claims where user_id = p_user and day = d), 'day', d);
end $$;
revoke all on function public._daily_task_items(uuid) from public, anon, authenticated;

create or replace function public.daily_task_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTH'; end if;
  return public._daily_task_items(auth.uid()) || jsonb_build_object('enabled', coalesce(public.setting_text('daily_task_enabled'), 'false') = 'true');
end $$;

create or replace function public.daily_task_claim()
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); st jsonb; h text := public._my_device(u); c int; d date := public.today_bd();
begin
  if coalesce(public.setting_text('daily_task_enabled'), 'false') <> 'true' then raise exception 'DISABLED'; end if;
  perform 1 from profiles where id = u for update;
  st := public._daily_task_items(u);
  if (st->>'claimed')::boolean then raise exception 'ALREADY_CLAIMED'; end if;
  if not (st->>'done')::boolean then raise exception 'NOT_DONE'; end if;
  if coalesce(public.setting_text('bonus_need_device'), 'true') = 'true' then
    if h is null then raise exception 'NEED_APP'; end if;
    if exists (select 1 from daily_task_claims where day = d and device_hash = h and user_id <> u) then raise exception 'DEVICE_USED'; end if;
  end if;
  c := greatest((st->>'coins')::int, 0);
  insert into daily_task_claims (user_id, day, kind, coins, device_hash) values (u, d, case when (st->>'host')::boolean then 'host' else 'user' end, c, h);
  if c > 0 then perform public._wallet_move(u, 'coin', c, 'daily_task_reward', 'daily_task', null, '🎯 দৈনিক টার্গেট', 'dtask:' || u || ':' || d); end if;
  return jsonb_build_object('ok', true, 'coins', c);
end $$;
revoke all on function public.daily_task_status() from public, anon;
revoke all on function public.daily_task_claim() from public, anon;
grant execute on function public.daily_task_status() to authenticated;
grant execute on function public.daily_task_claim() to authenticated;

-- ===== হোস্টের ভিডিওতে লাইক/কমেন্ট/শেয়ারে কয়েন =====
create table if not exists host_engage_rewards (
  actor_id uuid not null, video_id bigint not null, kind text not null, host_id uuid not null, coins int not null,
  created_at timestamptz not null default now(), primary key (actor_id, video_id, kind));
alter table host_engage_rewards enable row level security;
create index if not exists her_host_day on host_engage_rewards (host_id, created_at);

create or replace function public._host_engage(p_actor uuid, p_video bigint, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare cfg jsonb := coalesce((select value from settings where key = 'host_engage'), '{}'::jsonb); h uuid; c int; cap int; got int;
  d0 timestamptz := (public.today_bd()::timestamp at time zone 'Asia/Dhaka');
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return; end if;
  select v.user_id into h from videos v join profiles p on p.id = v.user_id where v.id = p_video and v.status = 'published' and p.account_type = 'host';
  if h is null or h = p_actor then return; end if;
  if not public._device_primary(p_actor) then return; end if;                -- একই মোবাইলের বাড়তি অ্যাকাউন্ট গোনা হবে না
  if exists (select 1 from user_devices a join user_devices b on a.device_hash = b.device_hash where a.user_id = p_actor and b.user_id = h) then return; end if;
  c := greatest(coalesce((cfg->>'coins')::int, 0), 0); cap := coalesce((cfg->>'daily_cap')::int, 0);
  if c = 0 then return; end if;
  if cap > 0 then
    select coalesce(sum(coins), 0) into got from host_engage_rewards where host_id = h and created_at >= d0;
    c := least(c, cap - got); if c <= 0 then return; end if;
  end if;
  insert into host_engage_rewards (actor_id, video_id, kind, host_id, coins) values (p_actor, p_video, p_kind, h, c) on conflict do nothing;
  if not found then return; end if;
  perform public._wallet_move(h, 'coin', c, 'host_engage_reward', 'video', p_video,
    case p_kind when 'like' then '❤️ লাইক' when 'comment' then '💬 কমেন্ট' else '↗️ শেয়ার' end, 'he:' || p_actor || ':' || p_video || ':' || p_kind);
exception when others then null;   -- লাইক/কমেন্ট কখনো আটকাবে না
end $$;
revoke all on function public._host_engage(uuid, bigint, text) from public, anon, authenticated;

create or replace function public.tg_host_engage() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._host_engage(new.user_id, new.video_id, tg_argv[0]);
  return new;
end $$;
drop trigger if exists host_engage_like on likes;
create trigger host_engage_like after insert on likes for each row execute function public.tg_host_engage('like');
drop trigger if exists host_engage_comment on comments;
create trigger host_engage_comment after insert on comments for each row execute function public.tg_host_engage('comment');
drop trigger if exists host_engage_share on shares;
create trigger host_engage_share after insert on shares for each row execute function public.tg_host_engage('share');

-- ===== রেফার: যে রেফার করেছে তারও ২ ভিডিও + ২ লেখা, নতুন জনের টাকা, হোস্টের প্রতি ৩ জনে বোনাস =====
create or replace function public._check_referral(p_user uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare p record; cnt int; t record; pr jsonb; bonus bigint; tgt int; acnt int; rhost boolean; nb bigint; every int;
        hold interval := make_interval(hours => public.setting_int('pending_hold_hours')::int);
begin
  if public.setting_text('referral_enabled') <> 'true' then return; end if;
  select * into p from profiles where id = p_user for update;
  if p.referred_by is null or p.referral_qualified_at is not null or p.referral_blocked is not null then return; end if;
  if coalesce(public.setting_text('referral_block_same_device'), 'true') = 'true' and exists (
      select 1 from user_devices mine join user_devices other on other.device_hash = mine.device_hash and other.user_id <> mine.user_id
      where mine.user_id = p_user) then
    update profiles set referral_blocked = 'same_device' where id = p_user;
    perform public._notify(p.referred_by, 'system', '⚠️ রেফার বাতিল: @' || p.username,
      'এই মোবাইলে আগে অন্য অ্যাকাউন্ট খোলা হয়েছে, তাই এই রেফারের বোনাস দেওয়া হবে না।', '{}'::jsonb);
    return;
  end if;
  pr := public._referral_progress(p_user);
  if not coalesce((pr->>'done')::boolean, false) then
    if now() > (pr->>'end')::timestamptz + interval '3 days' then
      update profiles set referral_blocked = 'expired' where id = p_user;
      perform public._notify(p.referred_by, 'system', '⌛ রেফার সময় শেষ: @' || p.username,
        'নির্দিষ্ট সময়ের মধ্যে সব টাস্ক শেষ হয়নি, তাই এই রেফারের বোনাস দেওয়া হবে না।', '{}'::jsonb);
    end if;
    return;
  end if;
  if coalesce(public.setting_text('referral_require_device'), 'true') = 'true'
     and not exists (select 1 from user_devices where user_id = p_user) then return; end if;
  if not exists (select 1 from profiles where id = p.referred_by and status = 'active') then return; end if;
  -- যে রেফার করেছে তাকেও কমপক্ষে N ভিডিও ও N লেখা পোস্ট করতে হবে (না হওয়া পর্যন্ত অপেক্ষা)
  if (select count(*) from videos where user_id = p.referred_by and status = 'published') < public.setting_int('ref_referrer_min_videos')
     or (select count(*) from posts where user_id = p.referred_by and kind = 'text' and status = 'published') < public.setting_int('ref_referrer_min_texts') then
    return;
  end if;
  update profiles set referral_qualified_at = now() where id = p_user;
  rhost := (select account_type from profiles where id = p.referred_by) = 'host';
  bonus := case when p.ref_agent then public.setting_int('agent_ref_bonus_paisa')::bigint else public._urate(p.referred_by, 'referral_bonus_paisa') end;
  perform public._wallet_move(p.referred_by, 'pending', bonus, 'referral_bonus', 'user', null, '@' || p.username, 'ref:' || p_user, now() + hold);
  nb := public.setting_int(case when rhost then 'host_ref_new_user_paisa' else 'ref_new_user_paisa' end);
  if nb > 0 then
    perform public._wallet_move(p_user, 'pending', nb, 'referral_bonus', 'user', null, '🎁 রেফারে যোগ দেওয়ার বোনাস', 'refn:' || p_user, now() + hold);
  end if;
  if public.setting_int('referral_welcome_points') > 0 then
    perform public._wallet_move(p_user, 'points', public.setting_int('referral_welcome_points'), 'referral_welcome', 'user', null, null, 'refw:' || p_user);
  end if;
  perform public._notify(p.referred_by, 'system', '🎉 রেফার সফল! @' || p.username, 'আপনি পাবেন ৳' || round(bonus / 100.0, 2), '{}'::jsonb);
  perform public._notify(p_user, 'system', '🎉 রেফারের সব টাস্ক শেষ!',
    case when nb > 0 then 'আপনি পাবেন ৳' || round(nb / 100.0, 2) else 'রেফার সফল হয়েছে' end, '{}'::jsonb);
  -- হোস্ট: প্রতি N সফল রেফারে বাড়তি বোনাস
  if rhost and not coalesce(p.ref_agent, false) then
    every := greatest(public.setting_int('host_ref_every_n'), 0);
    if every > 0 and public.setting_int('host_ref_every_paisa') > 0 then
      select count(*) into acnt from profiles where referred_by = p.referred_by and referral_qualified_at is not null;
      if acnt % every = 0 then
        perform public._wallet_move(p.referred_by, 'pending', public.setting_int('host_ref_every_paisa'), 'referral_tier_bonus', 'user', null,
          acnt || ' জন রেফার বোনাস', 'hrefn:' || p.referred_by || ':' || (acnt / every), now() + hold);
        perform public._notify(p.referred_by, 'system', '🏅 ' || acnt || ' জন রেফার পূরণ!',
          'বাড়তি বোনাস ৳' || round(public.setting_int('host_ref_every_paisa') / 100.0, 2), '{}'::jsonb);
      end if;
    end if;
  end if;
  if p.ref_agent then
    tgt := greatest(public.setting_int('agent_target_refs'), 0);
    if tgt > 0 and public.setting_int('agent_target_bonus_paisa') > 0 then
      select count(*) into acnt from profiles where referred_by = p.referred_by and ref_agent and referral_qualified_at is not null;
      if acnt % tgt = 0 then
        perform public._wallet_move(p.referred_by, 'pending', public.setting_int('agent_target_bonus_paisa'), 'agent_target_bonus', 'user', null,
                                    acnt || ' জন এজেন্ট টার্গেট', 'agt:' || p.referred_by || ':' || (acnt / tgt), now() + hold);
        perform public._notify(p.referred_by, 'system', '🏅 এজেন্ট টার্গেট পূরণ! ' || acnt || ' জন',
                               'বাড়তি বোনাস ৳' || round(public.setting_int('agent_target_bonus_paisa') / 100.0, 2), '{}'::jsonb);
      end if;
    end if;
  end if;
  select count(*) into cnt from profiles where referred_by = p.referred_by and referral_qualified_at is not null;
  for t in select * from referral_tiers where is_active and referrals <= cnt
           and id not in (select tier_id from referral_tier_awards where user_id = p.referred_by) order by referrals loop
    insert into referral_tier_awards (user_id, tier_id) values (p.referred_by, t.id);
    perform public._wallet_move(p.referred_by, 'pending', t.bonus_paisa, 'referral_tier_bonus', 'tier', t.id,
                                t.referrals || ' জন রেফার বোনাস', 'reft:' || p.referred_by || ':' || t.id, now() + hold);
    perform public._notify(p.referred_by, 'system', '🏆 ' || t.referrals || ' জন রেফার বোনাস!',
                           'আপনি পাবেন ৳' || round(t.bonus_paisa / 100.0, 2), '{}'::jsonb);
  end loop;
end $function$;

-- ===== ১০ দিনের টপ রেফার বোনাস (মাসে ৩ বার: ১–১০, ১১–২০, ২১–শেষ) =====
create table if not exists ref_top_awards (
  period_start date not null, user_id uuid not null references profiles(id) on delete cascade, kind text not null,
  rank int not null, refs int not null, active int not null, active_pct int not null, paisa bigint not null,
  created_at timestamptz not null default now(), primary key (period_start, user_id));
alter table ref_top_awards enable row level security;
drop policy if exists rta_read on ref_top_awards;
create policy rta_read on ref_top_awards for select using (true);
create table if not exists ref_top_periods (period_start date primary key, period_end date not null, settled_at timestamptz);
alter table ref_top_periods enable row level security;

create or replace function public._ref_period(d date)
returns table(ps date, pe date) language sql immutable as $$
  select case when extract(day from d) <= 10 then date_trunc('month', d)::date
              when extract(day from d) <= 20 then (date_trunc('month', d) + interval '10 days')::date
              else (date_trunc('month', d) + interval '20 days')::date end,
         case when extract(day from d) <= 10 then (date_trunc('month', d) + interval '9 days')::date
              when extract(day from d) <= 20 then (date_trunc('month', d) + interval '19 days')::date
              else (date_trunc('month', d) + interval '1 month' - interval '1 day')::date end;
$$;

-- একটি সময়ের র‍্যাংকিং (kind = user|host)
create or replace function public._ref_top_board(p_kind text, p_start date, p_end date)
returns table(user_id uuid, refs int, active int, active_pct int, tier_paisa bigint, rnk int)
language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb := coalesce((select value from settings where key = 'ref_top_' || p_kind), '{}'::jsonb);
  t0 timestamptz := (p_start::timestamp at time zone 'Asia/Dhaka'); t1 timestamptz := ((p_end + 1)::timestamp at time zone 'Asia/Dhaka');
begin
  return query
  with c as (
    select r.referred_by uid, count(*)::int n, count(*) filter (where r.referral_qualified_at is not null)::int a
    from profiles r join profiles ref on ref.id = r.referred_by
    where coalesce(r.referred_at, r.created_at) >= t0 and coalesce(r.referred_at, r.created_at) < t1
      and coalesce(r.referral_blocked, '') <> 'same_device' and ref.status = 'active'
      and (case when p_kind = 'host' then ref.account_type = 'host' else ref.account_type <> 'host' end)
    group by 1),
  e as (
    select c.uid, c.n, c.a, (c.a * 100 / greatest(c.n, 1))::int pct,
      (select max((x->>'paisa')::bigint) from jsonb_array_elements(cfg->'tiers') x
        where c.n >= (x->>'refs')::int and (c.a * 100 / greatest(c.n, 1)) >= (x->>'active')::int) paisa
    from c)
  select e.uid, e.n, e.a, e.pct, coalesce(e.paisa, 0)::bigint, (row_number() over (order by e.n desc, e.a desc))::int
  from e order by e.n desc, e.a desc limit 100;
end $$;
revoke all on function public._ref_top_board(text, date, date) from public, anon, authenticated;

create or replace function public.ref_top_settle()
returns int language plpgsql security definer set search_path = public as $$
declare per record; pr record; k text; top int; r record; paid int := 0; today date := public.today_bd();
  hold interval := make_interval(hours => public.setting_int('pending_hold_hours')::int);
begin
  if coalesce(public.setting_text('ref_top_enabled'), 'false') <> 'true' then return 0; end if;
  -- শেষ হওয়া আগের সময়টা খাতায় তোলা
  select * into pr from public._ref_period(today - 1);
  if pr.pe < today then insert into ref_top_periods (period_start, period_end) values (pr.ps, pr.pe) on conflict do nothing; end if;
  for per in select * from ref_top_periods where settled_at is null and period_end < today order by period_start loop
    foreach k in array array['user', 'host'] loop
      top := coalesce(((select value from settings where key = 'ref_top_' || k)->>'top')::int, 0);
      for r in select b.* from public._ref_top_board(k, per.period_start, per.period_end) b where b.tier_paisa > 0 order by b.rnk limit top loop
        insert into ref_top_awards (period_start, user_id, kind, rank, refs, active, active_pct, paisa)
          values (per.period_start, r.user_id, k, r.rnk, r.refs, r.active, r.active_pct, r.tier_paisa) on conflict do nothing;
        if found then
          perform public._wallet_move(r.user_id, 'pending', r.tier_paisa, 'referral_tier_bonus', 'ref_top', null,
            '🏆 টপ রেফার বোনাস (' || to_char(per.period_start, 'DD/MM') || '–' || to_char(per.period_end, 'DD/MM') || ')',
            'rtop:' || per.period_start || ':' || r.user_id, now() + hold);
          perform public._notify(r.user_id, 'system', '🏆 টপ রেফার বোনাস!', 'আপনি পাবেন ৳' || round(r.tier_paisa / 100.0, 2), '{}'::jsonb);
          paid := paid + 1;
        end if;
      end loop;
    end loop;
    update ref_top_periods set settled_at = now() where period_start = per.period_start;
  end loop;
  return paid;
end $$;
revoke all on function public.ref_top_settle() from public, anon, authenticated;

create or replace function public.my_ref_top()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); k text; per record; me record; cfg jsonb;
begin
  if u is null then raise exception 'NOT_AUTH'; end if;
  k := case when (select account_type from profiles where id = u) = 'host' then 'host' else 'user' end;
  select * into per from public._ref_period(public.today_bd());
  cfg := coalesce((select value from settings where key = 'ref_top_' || k), '{}'::jsonb);
  select b.* into me from public._ref_top_board(k, per.ps, per.pe) b where b.user_id = u;
  return jsonb_build_object('enabled', coalesce(public.setting_text('ref_top_enabled'), 'false') = 'true', 'kind', k,
    'start', per.ps, 'end', per.pe, 'top', cfg->'top', 'tiers', cfg->'tiers',
    'refs', coalesce(me.refs, 0), 'active', coalesce(me.active, 0), 'active_pct', coalesce(me.active_pct, 0), 'rank', me.rnk,
    'won', (select jsonb_agg(jsonb_build_object('start', period_start, 'paisa', paisa, 'rank', rank) order by period_start desc)
            from ref_top_awards where user_id = u));
end $$;
revoke all on function public.my_ref_top() from public, anon;
grant execute on function public.my_ref_top() to authenticated;

create or replace function public.admin_ref_top(p_kind text, p_start date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare per record;
begin
  perform public._require_admin();
  select * into per from public._ref_period(coalesce(p_start, public.today_bd()));
  return jsonb_build_object('start', per.ps, 'end', per.pe,
    'rows', (select jsonb_agg(jsonb_build_object('user_no', p.user_no, 'username', p.username, 'full_name', p.full_name,
               'refs', b.refs, 'active', b.active, 'active_pct', b.active_pct, 'tier_paisa', b.tier_paisa, 'rank', b.rnk) order by b.rnk)
             from public._ref_top_board(p_kind, per.ps, per.pe) b join profiles p on p.id = b.user_id),
    'paid', (select jsonb_agg(jsonb_build_object('user_no', p.user_no, 'username', p.username, 'rank', a.rank, 'paisa', a.paisa, 'refs', a.refs, 'active_pct', a.active_pct) order by a.rank)
             from ref_top_awards a join profiles p on p.id = a.user_id where a.period_start = per.ps and a.kind = p_kind));
end $$;
revoke all on function public.admin_ref_top(text, date) from public, anon;
grant execute on function public.admin_ref_top(text, date) to authenticated;

select cron.unschedule('ref-top-settle') where exists (select 1 from cron.job where jobname = 'ref-top-settle');
select cron.schedule('ref-top-settle', '30 18 * * *', 'select public.ref_top_settle()');   -- রাত ১২:৩০ (বাংলাদেশ)

-- 059f: site_info() settings list now also returns ref_new_user_paisa, host_referral_bonus_paisa, host_ref_new_user_paisa,
-- host_ref_every_n/_paisa, ref_referrer_min_videos/texts, daily_task_enabled/user/host, host_engage, ref_top_enabled/user/host,
-- fast_withdraw_days, beans_min_withdraw, bean_value_paisa, coins_per_bean, beans_enabled (applied directly in the DB).
