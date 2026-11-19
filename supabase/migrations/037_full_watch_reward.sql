-- 037: ভিউয়ার পয়েন্ট শুধু পুরো ভিডিও দেখলে (ছোট-বড় সব ভিডিওতে)
-- record_view (min_watch_ms) আগের মতো ভিউ গোনে ও ক্রিয়েটরের আয়/রেফার চালায়, কিন্তু আর পয়েন্ট দেয় না।
-- claim_watch_reward: ভিডিওর দৈর্ঘ্যের watch_full_pct % দেখা হলে, ভিউ রেকর্ডের পর বাস্তবে ততটা সময় পার হলে, দিনে একবার পয়েন্ট।
alter table public.video_views add column if not exists rewarded_at timestamptz;

insert into settings (key, value, description) values
  ('watch_full_pct', '95'::jsonb, 'ভিডিওর কত % দেখলে পয়েন্ট (পুরো দেখা)')
on conflict (key) do nothing;

create or replace function public.record_view(p_video_id bigint, p_watch_ms integer)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare u uuid := public._active_user(); v record; d date := public.today_bd(); n int;
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
  perform public._check_referral(u);
  return json_build_object('counted', true, 'points', 0);
end $function$;

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
  -- বাস্তব সময় যাচাই: ভিউ রেকর্ড হওয়ার পর বাকি অংশ দেখার সময়টা সত্যিই পার হয়েছে কিনা (৮০% সহনশীলতা)
  if extract(epoch from (now() - vv.created_at)) * 1000 < (need_ms - public.setting_int('min_watch_ms')) * 0.8 then
    return json_build_object('ok', false, 'reason', 'too_fast');
  end if;
  update video_views set rewarded_at = now(), watch_ms = least(greatest(watch_ms, p_watch_ms), 600000) where id = vv.id;
  pts := public.setting_int('watch_points');
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
revoke execute on function public.claim_watch_reward(bigint, integer) from public, anon;
grant execute on function public.claim_watch_reward(bigint, integer) to authenticated;
