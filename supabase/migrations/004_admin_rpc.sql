-- ========== ADMIN RPCs ==========

create or replace function public.admin_dashboard() returns json
language plpgsql stable security definer set search_path = public as $$
declare d date := public.today_bd(); r json;
begin
  perform public._require_admin();
  select json_build_object(
    'users_total',        (select count(*) from profiles),
    'users_today',        (select count(*) from profiles where (created_at at time zone 'Asia/Dhaka')::date = d),
    'users_banned',       (select count(*) from profiles where status = 'banned'),
    'videos_total',       (select count(*) from videos where status = 'published'),
    'videos_today',       (select count(*) from videos where (created_at at time zone 'Asia/Dhaka')::date = d),
    'views_today',        (select count(*) from video_views where view_date = d),
    'withdraw_pending',   (select count(*) from withdraw_requests where status in ('pending','approved')),
    'withdraw_pending_paisa', (select coalesce(sum(payable_paisa),0) from withdraw_requests where status in ('pending','approved')),
    'cashin_pending',     (select count(*) from cash_in_requests where status = 'pending'),
    'cashin_pending_paisa',(select coalesce(sum(amount_paisa),0) from cash_in_requests where status = 'pending'),
    'gift_fee_today_paisa',(select coalesce(sum(platform_fee_paisa),0) from gift_transactions where (created_at at time zone 'Asia/Dhaka')::date = d),
    'gift_fee_month_paisa',(select coalesce(sum(platform_fee_paisa),0) from gift_transactions where created_at >= date_trunc('month', now())),
    'cashin_month_paisa', (select coalesce(sum(amount_paisa),0) from cash_in_requests where status = 'approved' and reviewed_at >= date_trunc('month', now())),
    'paid_month_paisa',   (select coalesce(sum(payable_paisa),0) from withdraw_requests where status = 'paid' and paid_at >= date_trunc('month', now())),
    'liability_paisa',    (select coalesce(sum(earning_paisa + pending_paisa),0) from wallets),
    'coins_outstanding',  (select coalesce(sum(coin_balance),0) from wallets),
    'reports_open',       (select count(*) from content_reports where status = 'open')
  ) into r;
  return r;
end $$;

create or replace function public.admin_users(p_q text default null, p_status text default null,
                                              p_limit int default 50, p_offset int default 0)
returns table (id uuid, username text, full_name text, phone text, role text, status text, ban_reason text,
               videos_count int, followers_count int, coin_balance bigint, earning_paisa bigint,
               pending_paisa bigint, points bigint, is_frozen boolean, total_earned_paisa bigint,
               total_withdrawn_paisa bigint, created_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  select p.id, p.username, p.full_name, up.phone, p.role, p.status, p.ban_reason, p.videos_count,
         p.followers_count, w.coin_balance, w.earning_paisa, w.pending_paisa, w.points, w.is_frozen,
         w.total_earned_paisa, w.total_withdrawn_paisa, p.created_at, count(*) over ()
  from profiles p
  left join user_private up on up.user_id = p.id
  left join wallets w on w.user_id = p.id
  where (p_q is null or p_q = '' or p.username ilike '%' || p_q || '%' or p.full_name ilike '%' || p_q || '%'
         or up.phone like '%' || p_q || '%')
    and (p_status is null or p_status = '' or p.status = p_status)
  order by p.created_at desc
  limit p_limit offset p_offset;
end $$;

create or replace function public.admin_set_user_status(p_user uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_status not in ('active','banned') then raise exception 'BAD_STATUS'; end if;
  if p_user = auth.uid() then raise exception 'SELF'; end if;
  update profiles set status = p_status, ban_reason = case when p_status = 'banned' then p_reason end where id = p_user;
  perform public._audit(case when p_status = 'banned' then 'ban_user' else 'unban_user' end, 'user', p_user::text, p_reason);
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_role not in ('user','admin') then raise exception 'BAD_ROLE'; end if;
  if p_user = auth.uid() then raise exception 'SELF'; end if;
  update profiles set role = p_role where id = p_user;
  perform public._audit('set_role', 'user', p_user::text, p_role);
end $$;

create or replace function public.admin_set_verified(p_user uuid, p_verified boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update profiles set is_verified = p_verified where id = p_user;
  perform public._audit('set_verified', 'user', p_user::text, p_verified::text);
end $$;

create or replace function public.admin_adjust_wallet(p_user uuid, p_bucket text, p_amount bigint, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare a uuid := public._require_admin(); r bigint;
begin
  if p_bucket not in ('coin','earning','pending','points') then raise exception 'BAD_BUCKET'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'NOTE_REQUIRED'; end if;
  perform 1 from wallets where user_id = p_user for update;
  begin
    r := public._wallet_move(p_user, p_bucket, p_amount, 'admin_adjust', null, null, p_note, null, null, a);
  exception when check_violation then
    raise exception 'BALANCE_WOULD_BE_NEGATIVE';
  end;
  perform public._audit('adjust_balance', 'user', p_user::text, p_note,
                        json_build_object('bucket', p_bucket, 'amount', p_amount)::jsonb);
  perform public._notify(p_user, 'system', 'ব্যালেন্স অ্যাডজাস্ট করা হয়েছে', p_note, '{}'::jsonb);
  return r;
end $$;

create or replace function public.admin_freeze_wallet(p_user uuid, p_frozen boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update wallets set is_frozen = p_frozen where user_id = p_user;
  perform public._audit(case when p_frozen then 'freeze_wallet' else 'unfreeze_wallet' end, 'user', p_user::text, p_reason);
end $$;

create or replace function public.admin_video_action(p_id bigint, p_action text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public._require_admin();
  select * into v from videos where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action = 'feature' then
    update videos set is_featured = true where id = p_id;
  elsif p_action = 'unfeature' then
    update videos set is_featured = false where id = p_id;
  elsif p_action in ('reject','delete') then
    update videos set status = case when p_action = 'reject' then 'rejected' else 'deleted' end,
                      reject_reason = p_reason where id = p_id;
    if v.status = 'published' then
      update profiles set videos_count = greatest(videos_count - 1, 0) where id = v.user_id;
    end if;
    perform public._notify(v.user_id, 'system', 'আপনার একটি ভিডিও সরানো হয়েছে',
                           coalesce('কারণ: ' || p_reason, null), json_build_object('video_id', p_id)::jsonb);
  elsif p_action = 'restore' then
    update videos set status = 'published', reject_reason = null where id = p_id;
    if v.status <> 'published' then
      update profiles set videos_count = videos_count + 1 where id = v.user_id;
    end if;
  else
    raise exception 'BAD_ACTION';
  end if;
  perform public._audit('video_' || p_action, 'video', p_id::text, p_reason);
end $$;

create or replace function public.admin_cash_in_decide(p_id bigint, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := public._require_admin(); r record;
begin
  select * into r from cash_in_requests where id = p_id for update;
  if not found or r.status <> 'pending' then raise exception 'NOT_PENDING'; end if;
  if p_approve then
    update cash_in_requests set status = 'approved', reviewed_by = a, reviewed_at = now() where id = p_id;
    perform public._wallet_move(r.user_id, 'coin', r.coins, 'cash_in', 'cash_in', p_id,
                                r.method || ' ' || r.trx_id, 'cashin:' || p_id, null, a);
    perform public._notify(r.user_id, 'cash_in', 'ক্যাশ-ইন সফল', r.coins || ' কয়েন যোগ হয়েছে',
                           json_build_object('cash_in_id', p_id)::jsonb);
  else
    update cash_in_requests set status = 'rejected', reject_reason = p_reason, reviewed_by = a, reviewed_at = now()
      where id = p_id;
    perform public._notify(r.user_id, 'cash_in', 'ক্যাশ-ইন রিজেক্ট হয়েছে', 'কারণ: ' || coalesce(p_reason, '-'),
                           json_build_object('cash_in_id', p_id)::jsonb);
  end if;
  perform public._audit(case when p_approve then 'cashin_approve' else 'cashin_reject' end, 'cash_in', p_id::text, p_reason);
end $$;

-- উইথড্র: approve / paid (TrxID সহ) / reject (রিফান্ড)
create or replace function public.admin_withdraw_action(p_id bigint, p_action text, p_text text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := public._require_admin(); r record;
begin
  select * into r from withdraw_requests where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status not in ('pending','approved') then raise exception 'ALREADY_DONE'; end if;

  if p_action = 'approve' then
    if r.status <> 'pending' then raise exception 'NOT_PENDING'; end if;
    update withdraw_requests set status = 'approved', reviewed_by = a, reviewed_at = now() where id = p_id;
    perform public._notify(r.user_id, 'withdraw', 'উইথড্র অ্যাপ্রুভ হয়েছে', 'শীঘ্রই পেমেন্ট পাঠানো হবে',
                           json_build_object('withdraw_id', p_id)::jsonb);
  elsif p_action = 'paid' then
    if coalesce(trim(p_text), '') = '' then raise exception 'TRX_REQUIRED'; end if;
    update withdraw_requests set status = 'paid', payout_trx_id = trim(p_text), paid_at = now(),
           reviewed_by = a, reviewed_at = coalesce(reviewed_at, now()) where id = p_id;
    update wallets set total_withdrawn_paisa = total_withdrawn_paisa + r.payable_paisa where user_id = r.user_id;
    perform public._notify(r.user_id, 'withdraw', 'উইথড্র সফল ✅',
                           '৳' || round(r.payable_paisa / 100.0, 2) || ' আপনার ' || r.method || ' ' || r.account_number
                           || ' নম্বরে পাঠানো হয়েছে। TrxID: ' || trim(p_text),
                           json_build_object('withdraw_id', p_id)::jsonb);
  elsif p_action = 'reject' then
    if coalesce(trim(p_text), '') = '' then raise exception 'REASON_REQUIRED'; end if;
    update withdraw_requests set status = 'rejected', reject_reason = trim(p_text), reviewed_by = a, reviewed_at = now()
      where id = p_id;
    perform public._wallet_move(r.user_id, 'earning', r.amount_paisa, 'withdraw_refund', 'withdraw', p_id,
                                trim(p_text), 'wd-refund:' || p_id, null, a);
    perform public._notify(r.user_id, 'withdraw', 'উইথড্র রিজেক্ট হয়েছে',
                           'কারণ: ' || trim(p_text) || '। টাকা আপনার ব্যালেন্সে ফেরত দেওয়া হয়েছে।',
                           json_build_object('withdraw_id', p_id)::jsonb);
  else
    raise exception 'BAD_ACTION';
  end if;
  perform public._audit('withdraw_' || p_action, 'withdraw', p_id::text, p_text,
                        json_build_object('amount_paisa', r.amount_paisa, 'user', r.user_id)::jsonb);
end $$;

create or replace function public.admin_report_resolve(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_status not in ('resolved','dismissed') then raise exception 'BAD_STATUS'; end if;
  update content_reports set status = p_status, handled_by = auth.uid() where id = p_id;
  perform public._audit('report_' || p_status, 'report', p_id::text, null);
end $$;

create or replace function public.admin_broadcast(p_title text, p_body text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public._require_admin();
  insert into notifications (user_id, type, title, body)
    select id, 'system', p_title, p_body from profiles where status = 'active';
  get diagnostics n = row_count;
  perform public._audit('broadcast', null, null, p_title);
  return n;
end $$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare old jsonb;
begin
  perform public._require_admin();
  select value into old from settings where key = p_key;
  if not found then raise exception 'NO_SUCH_SETTING'; end if;
  update settings set value = p_value, updated_at = now() where key = p_key;
  perform public._audit('setting', 'setting', p_key, null, json_build_object('old', old, 'new', p_value)::jsonb);
end $$;

-- দৈনিক ইনকাম রিপোর্ট
create or replace function public.admin_income_report(p_from date, p_to date)
returns table (day date, new_users bigint, views bigint, gift_coins bigint, gift_fee_paisa bigint,
               creator_gift_paisa bigint, cash_in_paisa bigint, withdraw_paid_paisa bigint, ad_rewards bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  with days as (select generate_series(p_from, p_to, interval '1 day')::date as dd)
  select d.dd,
    (select count(*) from profiles x where (x.created_at at time zone 'Asia/Dhaka')::date = d.dd),
    (select count(*) from video_views x where x.view_date = d.dd),
    (select coalesce(sum(x.total_coins),0)::bigint from gift_transactions x where (x.created_at at time zone 'Asia/Dhaka')::date = d.dd),
    (select coalesce(sum(x.platform_fee_paisa),0)::bigint from gift_transactions x where (x.created_at at time zone 'Asia/Dhaka')::date = d.dd),
    (select coalesce(sum(x.creator_amount_paisa),0)::bigint from gift_transactions x where (x.created_at at time zone 'Asia/Dhaka')::date = d.dd),
    (select coalesce(sum(x.amount_paisa),0)::bigint from cash_in_requests x where x.status = 'approved' and (x.reviewed_at at time zone 'Asia/Dhaka')::date = d.dd),
    (select coalesce(sum(x.payable_paisa),0)::bigint from withdraw_requests x where x.status = 'paid' and (x.paid_at at time zone 'Asia/Dhaka')::date = d.dd),
    (select count(*) from public.ad_rewards x where (x.created_at at time zone 'Asia/Dhaka')::date = d.dd)
  from days d order by d.dd desc;
end $$;

create or replace function public.admin_top_creators(p_days int default 30)
returns table (user_id uuid, username text, full_name text, views bigint, likes bigint,
               gift_paisa bigint, view_paisa bigint, total_paisa bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  select s.user_id, p.username, p.full_name,
         sum(s.valid_views)::bigint, sum(s.likes)::bigint, sum(s.gift_paisa)::bigint,
         sum(s.view_paisa_credited)::bigint,
         (sum(s.gift_paisa) + sum(s.view_paisa_credited))::bigint as tot
  from creator_daily_stats s join profiles p on p.id = s.user_id
  where s.stat_date >= public.today_bd() - p_days
  group by s.user_id, p.username, p.full_name
  order by tot desc
  limit 50;
end $$;

-- Rewarded অ্যাড: শুধু edge function (service role) কল করতে পারে
create or replace function public.grant_ad_reward(p_ssv_tx text, p_viewer uuid, p_video_id bigint, p_placement text default 'rewarded_points')
returns json language plpgsql security definer set search_path = public as $$
declare pl record; today_n int; creator uuid; vp int; cp int; n int;
begin
  select * into pl from ad_placements where key = p_placement and is_active;
  if not found then return json_build_object('ok', false, 'reason', 'inactive'); end if;
  if not exists (select 1 from profiles where id = p_viewer and status = 'active') then
    return json_build_object('ok', false, 'reason', 'user');
  end if;
  select count(*) into today_n from ad_rewards
    where viewer_id = p_viewer and (created_at at time zone 'Asia/Dhaka')::date = public.today_bd();
  if p_video_id is not null then
    select user_id into creator from videos where id = p_video_id and status = 'published';
  end if;
  vp := case when pl.daily_cap is not null and today_n >= pl.daily_cap then 0 else pl.viewer_points end;
  cp := case when vp = 0 or creator is null or creator = p_viewer then 0 else pl.creator_points end;

  insert into ad_rewards (ssv_tx_id, placement_key, viewer_id, video_id, creator_id, viewer_points, creator_points)
  values (p_ssv_tx, p_placement, p_viewer, p_video_id, creator, vp, cp)
  on conflict (ssv_tx_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok', true, 'duplicate', true); end if;

  if vp > 0 then
    perform public._wallet_move(p_viewer, 'points', vp, 'ad_reward_viewer', 'ad', null, 'অ্যাড দেখে', 'ssv-v:' || p_ssv_tx);
  end if;
  if cp > 0 then
    perform public._wallet_move(creator, 'points', cp, 'ad_reward_creator', 'video', p_video_id, 'আপনার ভিডিওতে অ্যাড', 'ssv-c:' || p_ssv_tx);
  end if;
  return json_build_object('ok', true, 'viewer_points', vp, 'creator_points', cp);
end $$;
revoke execute on function public.grant_ad_reward from public, anon, authenticated;
grant execute on function public.grant_ad_reward to service_role;

-- ফোন দিয়ে লগইনের জন্য (edge function ব্যবহার করে)
create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where username = lower(p_username));
$$;
