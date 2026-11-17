-- ========== USER RPCs ==========

-- ফিড: foryou / following / নির্দিষ্ট ইউজার
create or replace function public.feed(p_type text default 'foryou', p_before bigint default null,
                                       p_limit int default 10, p_user uuid default null)
returns table (id bigint, user_id uuid, username text, full_name text, avatar_url text, is_verified boolean,
               caption text, video_url text, thumb_url text, views_count bigint, likes_count int,
               comments_count int, shares_count int, gifts_coins_total bigint, allow_comments boolean,
               allow_gifts boolean, is_featured boolean, created_at timestamptz,
               liked_by_me boolean, following boolean)
language sql stable security definer set search_path = public as $$
  select v.id, v.user_id, p.username, p.full_name, p.avatar_url, p.is_verified,
         v.caption, v.video_url, v.thumb_url, v.views_count, v.likes_count,
         v.comments_count, v.shares_count, v.gifts_coins_total, v.allow_comments,
         v.allow_gifts, v.is_featured, v.created_at,
         exists (select 1 from likes l where l.video_id = v.id and l.user_id = auth.uid()),
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = v.user_id)
  from videos v join profiles p on p.id = v.user_id
  where v.status = 'published' and p.status = 'active'
    and (p_before is null or v.id < p_before)
    and (p_user is null or v.user_id = p_user)
    and (p_type <> 'following' or exists (select 1 from follows f
          where f.follower_id = auth.uid() and f.following_id = v.user_id))
  order by v.id desc
  limit least(greatest(p_limit, 1), 30);
$$;

-- ভিডিও তৈরি (স্টোরেজে আপলোডের পরে)
create or replace function public.create_video(p_video_path text, p_video_url text, p_thumb_url text,
                                               p_caption text, p_duration int)
returns bigint language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); v_id bigint; t text; h_id bigint;
begin
  if p_video_path is null or split_part(p_video_path, '/', 1) <> u::text then
    raise exception 'BAD_PATH';
  end if;
  if p_video_url not like '%/storage/v1/object/public/videos/' || p_video_path then
    raise exception 'BAD_URL';
  end if;
  if p_thumb_url is not null and p_thumb_url not like '%/storage/v1/object/public/thumbs/' || u::text || '/%' then
    raise exception 'BAD_THUMB';
  end if;
  if p_duration is not null and p_duration > public.setting_int('max_video_sec') + 2 then
    raise exception 'VIDEO_TOO_LONG';
  end if;
  if not public.is_admin() and
     (select count(*) from videos where user_id = u and created_at > now() - interval '1 day') >= 20 then
    raise exception 'UPLOAD_LIMIT';
  end if;

  insert into videos (user_id, caption, video_path, video_url, thumb_url, duration_sec, uploaded_by_admin)
  values (u, nullif(trim(p_caption), ''), p_video_path, p_video_url, p_thumb_url, p_duration, public.is_admin())
  returning id into v_id;
  update profiles set videos_count = videos_count + 1 where id = u;

  for t in select distinct lower(m[1]) from regexp_matches(coalesce(p_caption, ''), '#([^\s#]{1,60})', 'g') as m loop
    insert into hashtags (tag, use_count) values (t, 1)
      on conflict (tag) do update set use_count = hashtags.use_count + 1
      returning id into h_id;
    insert into video_hashtags values (v_id, h_id) on conflict do nothing;
  end loop;
  return v_id;
end $$;

create or replace function public.delete_my_video(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); v record;
begin
  select * into v from videos where id = p_id for update;
  if not found or (v.user_id <> u and not public.is_admin()) then raise exception 'NOT_FOUND'; end if;
  if v.status <> 'deleted' then
    update videos set status = 'deleted' where id = p_id;
    update profiles set videos_count = greatest(videos_count - 1, 0) where id = v.user_id;
  end if;
end $$;

-- ভিউ রেকর্ড: দিনে প্রতি ভিডিওতে ১টি পেইড ভিউ
create or replace function public.record_view(p_video_id bigint, p_watch_ms int) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); v record; d date := public.today_bd();
        n int; pts int; cap int; got int;
begin
  select id, user_id, status into v from videos where id = p_video_id;
  if not found or v.status <> 'published' or v.user_id = u then
    return json_build_object('counted', false);
  end if;
  if p_watch_ms < public.setting_int('min_watch_ms') then
    return json_build_object('counted', false, 'reason', 'short');
  end if;
  if (select count(*) from video_views where viewer_id = u and created_at > now() - interval '1 minute') >= 20 then
    return json_build_object('counted', false, 'reason', 'rate');
  end if;

  insert into video_views (video_id, viewer_id, creator_id, watch_ms, view_date)
  values (p_video_id, u, v.user_id, least(p_watch_ms, 600000), d)
  on conflict (video_id, viewer_id, view_date) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('counted', false, 'reason', 'dup'); end if;

  update videos set views_count = views_count + 1 where id = p_video_id;
  if public.setting_text('earnings_enabled') <> 'true' then
    return json_build_object('counted', true, 'points', 0);
  end if;

  insert into creator_daily_stats (user_id, stat_date, valid_views) values (v.user_id, d, 1)
    on conflict (user_id, stat_date) do update set valid_views = creator_daily_stats.valid_views + 1;

  pts := public.setting_int('watch_points');
  cap := public.setting_int('viewer_daily_points_cap');
  insert into viewer_daily_points (user_id, stat_date) values (u, d) on conflict do nothing;
  select points into got from viewer_daily_points where user_id = u and stat_date = d for update;
  pts := greatest(least(pts, cap - got), 0);
  if pts > 0 then
    update viewer_daily_points set points = points + pts where user_id = u and stat_date = d;
    perform public._wallet_move(u, 'points', pts, 'watch_reward', 'video', p_video_id, null,
                                'watch:' || u || ':' || p_video_id || ':' || d);
  end if;
  return json_build_object('counted', true, 'points', pts);
end $$;

create or replace function public.toggle_like(p_video_id bigint) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); v record; n int; liked boolean; cnt int; uname text;
begin
  select id, user_id, status into v from videos where id = p_video_id;
  if not found or v.status <> 'published' then raise exception 'NOT_FOUND'; end if;

  delete from likes where user_id = u and video_id = p_video_id;
  get diagnostics n = row_count;
  if n > 0 then
    update videos set likes_count = greatest(likes_count - 1, 0) where id = p_video_id returning likes_count into cnt;
    liked := false;
  else
    insert into likes (user_id, video_id) values (u, p_video_id);
    update videos set likes_count = likes_count + 1 where id = p_video_id returning likes_count into cnt;
    liked := true;
    if v.user_id <> u then
      insert into like_rewards values (u, p_video_id) on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        if public.setting_text('earnings_enabled') = 'true' then
          perform public._wallet_move(v.user_id, 'pending', public.setting_int('like_rate_paisa'), 'like_earning',
                    'video', p_video_id, null, 'like:' || u || ':' || p_video_id,
                    now() + make_interval(hours => public.setting_int('pending_hold_hours')::int));
          insert into creator_daily_stats (user_id, stat_date, likes) values (v.user_id, public.today_bd(), 1)
            on conflict (user_id, stat_date) do update set likes = creator_daily_stats.likes + 1;
        end if;
        select username into uname from profiles where id = u;
        perform public._notify(v.user_id, 'like', uname || ' আপনার ভিডিও লাইক করেছে', null,
                               json_build_object('video_id', p_video_id)::jsonb);
      end if;
    end if;
  end if;
  return json_build_object('liked', liked, 'likes_count', cnt);
end $$;

create or replace function public.add_comment(p_video_id bigint, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); v record; c_id bigint; n int; uname text;
begin
  select id, user_id, status, allow_comments into v from videos where id = p_video_id;
  if not found or v.status <> 'published' then raise exception 'NOT_FOUND'; end if;
  if not v.allow_comments then raise exception 'COMMENTS_OFF'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'EMPTY'; end if;
  if (select count(*) from comments where user_id = u and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'RATE_LIMIT';
  end if;

  insert into comments (video_id, user_id, body) values (p_video_id, u, left(trim(p_body), 1000))
    returning id into c_id;
  update videos set comments_count = comments_count + 1 where id = p_video_id;

  if v.user_id <> u then
    insert into comment_rewards values (p_video_id, u) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 and public.setting_text('earnings_enabled') = 'true' then
      perform public._wallet_move(v.user_id, 'pending', public.setting_int('comment_rate_paisa'), 'comment_earning',
                'video', p_video_id, null, 'comment:' || u || ':' || p_video_id,
                now() + make_interval(hours => public.setting_int('pending_hold_hours')::int));
      insert into creator_daily_stats (user_id, stat_date, comments) values (v.user_id, public.today_bd(), 1)
        on conflict (user_id, stat_date) do update set comments = creator_daily_stats.comments + 1;
    end if;
    select username into uname from profiles where id = u;
    perform public._notify(v.user_id, 'comment', uname || ' কমেন্ট করেছে', left(p_body, 100),
                           json_build_object('video_id', p_video_id)::jsonb);
  end if;
  return c_id;
end $$;

create or replace function public.delete_comment(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); rc record;
begin
  select cm.user_id, cm.status, cm.video_id, v.user_id as owner into rc
    from comments cm join videos v on v.id = cm.video_id where cm.id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if rc.user_id <> u and rc.owner <> u and not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if rc.status = 'visible' then
    update comments set status = 'hidden' where id = p_id;
    update videos set comments_count = greatest(comments_count - 1, 0) where id = rc.video_id;
  end if;
end $$;

create or replace function public.toggle_follow(p_target uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); n int; uname text;
begin
  if p_target = u then raise exception 'SELF'; end if;
  delete from follows where follower_id = u and following_id = p_target;
  get diagnostics n = row_count;
  if n > 0 then return false; end if;
  insert into follows (follower_id, following_id) values (u, p_target);
  select username into uname from profiles where id = u;
  perform public._notify(p_target, 'follow', uname || ' আপনাকে ফলো করেছে', null,
                         json_build_object('user_id', u)::jsonb);
  return true;
end $$;

create or replace function public.share_video(p_video_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  insert into shares (video_id, user_id) values (p_video_id, u);
  update videos set shares_count = shares_count + 1 where id = p_video_id;
end $$;

-- গিফট: প্রেরকের কয়েন ডেবিট → ক্রিয়েটরের pending ক্রেডিট → প্ল্যাটফর্ম কমিশন
create or replace function public.send_gift(p_video_id bigint, p_gift_id int, p_qty int, p_idem text) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); g record; v record; w record; gt record;
        qty int; total_coins bigint; total_paisa bigint; creator_part bigint; fee bigint; uname text;
begin
  if p_idem is null or length(p_idem) < 8 then raise exception 'BAD_IDEM'; end if;
  select * into gt from gift_transactions where idem_key = p_idem;
  if found then
    return json_build_object('ok', true, 'duplicate', true,
      'coin_balance', (select coin_balance from wallets where user_id = u));
  end if;

  select * into g from gifts where id = p_gift_id and is_active;
  if not found then raise exception 'GIFT_NOT_FOUND'; end if;
  select id, user_id, status, allow_gifts into v from videos where id = p_video_id;
  if not found or v.status <> 'published' then raise exception 'NOT_FOUND'; end if;
  if not v.allow_gifts then raise exception 'GIFTS_OFF'; end if;
  if v.user_id = u then raise exception 'SELF_GIFT'; end if;

  qty := least(greatest(coalesce(p_qty, 1), 1), 99);
  total_coins := g.coin_price::bigint * qty;
  total_paisa := total_coins * public.setting_int('coin_price_paisa');
  creator_part := floor(total_paisa * g.creator_share_pct / 100);
  fee := total_paisa - creator_part;

  -- ডেডলক এড়াতে ছোট id আগে লক
  perform 1 from wallets where user_id in (u, v.user_id) order by user_id for update;
  select * into w from wallets where user_id = u;
  if w.coin_balance < total_coins then raise exception 'INSUFFICIENT_COINS'; end if;

  insert into gift_transactions (gift_id, sender_id, receiver_id, video_id, quantity, total_coins,
                                 creator_amount_paisa, platform_fee_paisa, idem_key)
  values (g.id, u, v.user_id, p_video_id, qty, total_coins, creator_part, fee, p_idem)
  returning * into gt;

  perform public._wallet_move(u, 'coin', -total_coins, 'gift_sent', 'gift_tx', gt.id,
                              g.icon || ' ' || g.name || ' x' || qty, 'gift-s:' || p_idem);
  perform public._wallet_move(v.user_id, 'pending', creator_part, 'gift_received', 'gift_tx', gt.id,
                              g.icon || ' ' || g.name || ' x' || qty, 'gift-r:' || p_idem,
                              now() + make_interval(hours => public.setting_int('pending_hold_hours')::int));
  update videos set gifts_coins_total = gifts_coins_total + total_coins where id = p_video_id;
  insert into creator_daily_stats (user_id, stat_date, gift_paisa) values (v.user_id, public.today_bd(), creator_part)
    on conflict (user_id, stat_date) do update set gift_paisa = creator_daily_stats.gift_paisa + creator_part;

  select username into uname from profiles where id = u;
  perform public._notify(v.user_id, 'gift', uname || ' আপনাকে ' || qty || 'টি ' || g.icon || ' ' || g.name || ' পাঠিয়েছে',
                         'আপনি পাবেন ৳' || round(creator_part / 100.0, 2),
                         json_build_object('video_id', p_video_id, 'gift_id', g.id, 'qty', qty)::jsonb);
  return json_build_object('ok', true, 'coin_balance', w.coin_balance - total_coins,
                           'gift', g.icon, 'qty', qty);
end $$;

create or replace function public.convert_points(p_points bigint) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); w record; paisa bigint;
begin
  if p_points < public.setting_int('points_convert_min') then raise exception 'BELOW_MIN'; end if;
  select * into w from wallets where user_id = u for update;
  if w.points < p_points then raise exception 'INSUFFICIENT_POINTS'; end if;
  paisa := p_points * public.setting_int('point_value_paisa');
  perform public._wallet_move(u, 'points', -p_points, 'points_convert', null, null, p_points || ' পয়েন্ট → ৳' || round(paisa/100.0,2));
  perform public._wallet_move(u, 'earning', paisa, 'points_convert', null, null, p_points || ' পয়েন্ট থেকে');
  return json_build_object('ok', true, 'paisa', paisa);
end $$;

create or replace function public.request_cash_in(p_method text, p_amount_taka int, p_sender text, p_trx text)
returns bigint language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); r_id bigint; coins bigint;
begin
  if p_method not in ('bkash','nagad','rocket') then raise exception 'BAD_METHOD'; end if;
  if p_amount_taka < public.setting_int('min_cash_in_taka') then raise exception 'BELOW_MIN'; end if;
  if p_sender !~ '^01[3-9][0-9]{8}$' then raise exception 'BAD_NUMBER'; end if;
  if length(trim(coalesce(p_trx, ''))) < 6 then raise exception 'BAD_TRX'; end if;
  if (select count(*) from cash_in_requests where user_id = u and status = 'pending') >= 3 then
    raise exception 'TOO_MANY_PENDING';
  end if;
  coins := floor(p_amount_taka * 100.0 / greatest(public.setting_int('coin_price_paisa'), 1));
  begin
    insert into cash_in_requests (user_id, method, amount_paisa, coins, sender_number, trx_id)
    values (u, p_method, p_amount_taka * 100, coins, p_sender, upper(trim(p_trx)))
    returning id into r_id;
  exception when unique_violation then
    raise exception 'TRX_USED';
  end;
  return r_id;
end $$;

create or replace function public.withdraw_eligibility() returns json
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public._active_user(); w record; last_at timestamptz; next_at timestamptz;
        age_ok boolean; open_req boolean; minp bigint := public.setting_int('withdraw_min_paisa');
begin
  select * into w from wallets where user_id = u;
  select max(created_at) into last_at from withdraw_requests where user_id = u and status <> 'rejected';
  if last_at is not null then
    next_at := last_at + make_interval(days => public.setting_int('withdraw_cooldown_days')::int);
  end if;
  select (created_at <= now() - make_interval(days => public.setting_int('min_account_age_days')::int))
    into age_ok from profiles where id = u;
  open_req := exists (select 1 from withdraw_requests where user_id = u and status in ('pending','approved'));
  return json_build_object(
    'can_withdraw', not w.is_frozen and age_ok and not open_req
                    and (next_at is null or next_at <= now()) and w.earning_paisa >= minp,
    'next_available_at', next_at,
    'min_paisa', minp,
    'balance_paisa', w.earning_paisa,
    'fee_pct', public.setting_int('withdraw_fee_pct'),
    'frozen', w.is_frozen,
    'account_age_ok', age_ok,
    'has_open_request', open_req);
end $$;

-- উইথড্র: ৭ দিনের কুলডাউন + টাকা হোল্ড
create or replace function public.request_withdraw(p_amount_paisa bigint, p_method text,
                                                   p_account text, p_name text) returns bigint
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); w record; last_at timestamptz; next_at timestamptz;
        fee bigint; r_id bigint;
begin
  if p_method not in ('bkash','nagad','rocket') then raise exception 'BAD_METHOD'; end if;
  if p_account !~ '^01[3-9][0-9]{8}$' then raise exception 'BAD_NUMBER'; end if;

  -- ১. ওয়ালেট লক: একই ইউজারের অন্য রিকোয়েস্ট এখানে অপেক্ষা করবে
  select * into w from wallets where user_id = u for update;
  if w.is_frozen then raise exception 'WALLET_FROZEN'; end if;
  if (select created_at from profiles where id = u)
       > now() - make_interval(days => public.setting_int('min_account_age_days')::int) then
    raise exception 'ACCOUNT_TOO_NEW';
  end if;

  -- ২. ৭ দিনের কুলডাউন (রিজেক্টেড রিকোয়েস্ট গোনা হয় না)
  select max(created_at) into last_at from withdraw_requests where user_id = u and status <> 'rejected';
  if last_at is not null then
    next_at := last_at + make_interval(days => public.setting_int('withdraw_cooldown_days')::int);
    if next_at > now() then
      raise exception 'WITHDRAW_COOLDOWN:%', to_char(next_at at time zone 'Asia/Dhaka', 'YYYY-MM-DD HH24:MI');
    end if;
  end if;

  -- ৩. মিনিমাম ও ব্যালেন্স
  if p_amount_paisa < public.setting_int('withdraw_min_paisa') then raise exception 'BELOW_MIN'; end if;
  if p_amount_paisa > w.earning_paisa then raise exception 'INSUFFICIENT_BALANCE'; end if;
  fee := floor(p_amount_paisa * public.setting_int('withdraw_fee_pct') / 100.0);

  -- ৪. রিকোয়েস্ট + টাকা হোল্ড
  begin
    insert into withdraw_requests (user_id, amount_paisa, fee_paisa, payable_paisa, method, account_number, account_name)
    values (u, p_amount_paisa, fee, p_amount_paisa - fee, p_method, p_account, nullif(trim(p_name), ''))
    returning id into r_id;
  exception when unique_violation then
    raise exception 'OPEN_REQUEST_EXISTS';
  end;
  perform public._wallet_move(u, 'earning', -p_amount_paisa, 'withdraw_hold', 'withdraw', r_id,
                              p_method || ' ' || p_account, 'wd-hold:' || r_id);
  return r_id;
end $$;

create or replace function public.report_content(p_type text, p_target text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  if (select count(*) from content_reports where reporter_id = u and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'RATE_LIMIT';
  end if;
  insert into content_reports (reporter_id, target_type, target_id, reason) values (u, p_type, p_target, left(p_reason, 200));
end $$;

create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set is_read = true where user_id = auth.uid() and not is_read;
$$;

create or replace function public.update_profile(p_full_name text, p_username text, p_bio text, p_avatar_url text)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  if p_username is not null and lower(p_username) !~ '^[a-z0-9_.]{3,30}$' then raise exception 'BAD_USERNAME'; end if;
  if p_avatar_url is not null and p_avatar_url not like '%/storage/v1/object/public/avatars/' || u::text || '/%' then
    raise exception 'BAD_AVATAR';
  end if;
  begin
    update profiles set
      full_name  = coalesce(nullif(trim(p_full_name), ''), full_name),
      username   = coalesce(lower(nullif(trim(p_username), '')), username),
      bio        = coalesce(p_bio, bio),
      avatar_url = coalesce(p_avatar_url, avatar_url)
    where id = u;
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN';
  end;
end $$;

-- ========== CRON JOBS ==========
-- প্রতি ঘণ্টায়: ভিউ-ইনকাম pending-এ ক্রেডিট
create or replace function public.credit_view_earnings() returns int
language plpgsql security definer set search_path = public as $$
declare r record; rate bigint := public.setting_int('view_rate_paisa_per_1000');
        cap bigint := public.setting_int('creator_daily_view_cap_paisa');
        hold int := public.setting_int('pending_hold_hours')::int;
        target bigint; delta bigint; n int := 0;
begin
  if public.setting_text('earnings_enabled') <> 'true' then return 0; end if;
  for r in select s.* from creator_daily_stats s
           join profiles p on p.id = s.user_id and p.status = 'active'
           join wallets w on w.user_id = s.user_id and not w.is_frozen
           where s.stat_date >= public.today_bd() - 1
           for update of s loop
    target := least(floor(r.valid_views * rate / 1000.0)::bigint, cap);
    delta := target - r.view_paisa_credited;
    if delta > 0 then
      perform public._wallet_move(r.user_id, 'pending', delta, 'view_earning', 'day', null,
                                  'ভিউ ইনকাম ' || r.stat_date, null, now() + make_interval(hours => hold));
      update creator_daily_stats set view_paisa_credited = target
        where user_id = r.user_id and stat_date = r.stat_date;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- প্রতি ঘণ্টায়: সময় পার হওয়া pending → earning
create or replace function public.release_pending() returns int
language plpgsql security definer set search_path = public as $$
declare t record; cur bigint; amt bigint; n int := 0;
begin
  for t in select tr.* from transactions tr
           join wallets w on w.user_id = tr.user_id and not w.is_frozen
           join profiles p on p.id = tr.user_id and p.status = 'active'
           where tr.bucket = 'pending' and not tr.released and tr.amount > 0 and tr.available_at <= now()
           order by tr.id
           for update of tr skip locked loop
    select pending_paisa into cur from wallets where user_id = t.user_id for update;
    amt := least(t.amount, cur);
    update transactions set released = true where id = t.id;
    if amt > 0 then
      perform public._wallet_move(t.user_id, 'pending', -amt, 'pending_release', 'tx', t.id, null, 'rel-p:' || t.id);
      perform public._wallet_move(t.user_id, 'earning', amt, 'pending_release', 'tx', t.id, null, 'rel-e:' || t.id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke execute on function public.credit_view_earnings, public.release_pending from public, anon, authenticated;

select cron.schedule('credit-view-earnings', '5 * * * *', 'select public.credit_view_earnings()');
select cron.schedule('release-pending', '20 * * * *', 'select public.release_pending()');
