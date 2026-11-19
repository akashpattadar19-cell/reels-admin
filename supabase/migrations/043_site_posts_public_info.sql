-- 043: অফার ও খবর পোস্ট (অ্যাপ + ওয়েবসাইটে একসাথে) + ওয়েবসাইটের জন্য পাবলিক তথ্য site_info()
create table if not exists site_posts (
  id bigserial primary key,
  kind text not null default 'offer' check (kind in ('offer', 'news')),
  title text not null,
  title_en text,
  body text,
  body_en text,
  image_url text,
  link_url text,
  show_app boolean not null default true,
  show_site boolean not null default true,
  pinned boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table site_posts enable row level security;
revoke all on site_posts from anon, authenticated;

create or replace function public._site_posts(p_site boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'title_en', title_en, 'body', body, 'body_en', body_en,
           'image_url', image_url, 'link_url', link_url, 'pinned', pinned, 'starts_at', starts_at, 'ends_at', ends_at, 'created_at', created_at)
           order by pinned desc, created_at desc), '[]')
    from (select * from site_posts
           where active and (case when p_site then show_site else show_app end)
             and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
           order by pinned desc, created_at desc limit 20) x;
$$;

-- অ্যাপ: চালু অফার/খবর
create or replace function public.app_offers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH'; end if;
  return public._site_posts(false);
end $$;

-- ওয়েবসাইট (লগইন ছাড়া): শুধু পাবলিক তথ্য — নিয়ম, অফার, চলমান প্রতিযোগিতা, বিজয়ী, মোট পরিসংখ্যান
create or replace function public.site_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st jsonb; s seasons; season jsonb; winners jsonb;
begin
  select jsonb_object_agg(key, value) into st from settings where key in (
    'apk_url', 'share_link', 'support_email', 'support_telegram', 'support_hours', 'support_enabled', 'latest_app_build',
    'welcome_bonus_enabled', 'welcome_bonus_paisa', 'referral_bonus_paisa', 'referral_welcome_points', 'ref_window_days', 'ref_offer_text', 'ref_offer_text_en',
    'ref_req_full_watch', 'ref_req_likes', 'ref_req_comments', 'ref_req_shares', 'ref_req_active_days', 'ref_req_minutes_per_day',
    'ref_req_video_posts', 'ref_req_text_posts',
    'withdraw_min_paisa', 'withdraw_cooldown_days', 'pending_hold_hours', 'coin_price_paisa', 'min_cash_in_taka',
    'view_rate_paisa_per_1000', 'like_rate_paisa', 'comment_rate_paisa', 'watch_points', 'viewer_daily_points_cap',
    'point_value_paisa', 'points_convert_min', 'upload_reward_coins', 'income_locks', 'daily_upload_limit', 'max_video_sec',
    'vip_enabled', 'store_enabled', 'downloads_enabled', 'dm_enabled');
  select * into s from seasons where published and (paid_at is null or paid_at > now() - interval '14 days')
   order by (now() between starts_at and ends_at) desc, (now() < starts_at) desc, ends_at desc limit 1;
  if found then
    season := public._season_json(s) - 'require_device' - 'published';
    if s.paid_at is null and now() >= s.starts_at then
      season := season || jsonb_build_object('top', (select coalesce(jsonb_agg(jsonb_build_object('rank', r.rank, 'score', r.score,
          'name', coalesce(p.full_name, p.username), 'username', p.username, 'avatar_url', p.avatar_url) order by r.rank), '[]')
        from (select * from public._season_ranked(s.id, case when array_length(s.creator_prizes, 1) > 0 then 'creator' else 'referral' end)
               where rank is not null and rank <= 5) r join profiles p on p.id = r.user_id));
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('season', se.title, 'season_en', se.title_en, 'board', w.board, 'rank', w.rank,
           'prize_paisa', w.prize_paisa, 'paid_at', w.paid_at, 'name', coalesce(p.full_name, p.username), 'username', p.username,
           'avatar_url', p.avatar_url) order by w.paid_at desc, w.board, w.rank), '[]')
    into winners
    from season_winners w join seasons se on se.id = w.season_id join profiles p on p.id = w.user_id
   where w.season_id in (select id from seasons where paid_at is not null order by paid_at desc limit 3) and w.rank <= 10;
  return jsonb_build_object(
    'settings', st,
    'season', season,
    'winners', winners,
    'posts', public._site_posts(true),
    'coin_offers', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'coins', coins, 'price_taka', price_taka, 'badge', badge, 'ends_at', ends_at)
                     order by sort, id), '[]') from coin_offers where active and (ends_at is null or ends_at > now())),
    'stats', jsonb_build_object(
      'users', (select count(*) from profiles where status = 'active' and role <> 'admin'),
      'videos', (select count(*) from videos where status = 'published'),
      'paid_count', (select count(*) from withdraw_requests where status = 'paid'),
      'paid_paisa', (select coalesce(sum(amount_paisa), 0) from withdraw_requests where status = 'paid')),
    'now', now());
end $$;

-- অ্যাডমিন
create or replace function public.admin_site_posts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.pinned desc, x.created_at desc) from site_posts x), '[]');
end $$;

create or replace function public.admin_save_site_post(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint;
begin
  perform public._require_admin();
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'TITLE'; end if;
  if coalesce(p->>'link_url', '') <> '' and p->>'link_url' !~ '^(https?://|#)' then raise exception 'BAD_URL'; end if;
  if v_id is null then
    insert into site_posts (kind, title, title_en, body, body_en, image_url, link_url, show_app, show_site, pinned, starts_at, ends_at, active)
    values (coalesce(p->>'kind', 'offer'), trim(p->>'title'), nullif(trim(p->>'title_en'), ''), nullif(trim(p->>'body'), ''), nullif(trim(p->>'body_en'), ''),
            nullif(p->>'image_url', ''), nullif(trim(p->>'link_url'), ''), coalesce((p->>'show_app')::boolean, true), coalesce((p->>'show_site')::boolean, true),
            coalesce((p->>'pinned')::boolean, false), nullif(p->>'starts_at', '')::timestamptz, nullif(p->>'ends_at', '')::timestamptz,
            coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update site_posts set kind = coalesce(p->>'kind', kind), title = trim(p->>'title'), title_en = nullif(trim(p->>'title_en'), ''),
           body = nullif(trim(p->>'body'), ''), body_en = nullif(trim(p->>'body_en'), ''), image_url = nullif(p->>'image_url', ''),
           link_url = nullif(trim(p->>'link_url'), ''), show_app = coalesce((p->>'show_app')::boolean, show_app),
           show_site = coalesce((p->>'show_site')::boolean, show_site), pinned = coalesce((p->>'pinned')::boolean, pinned),
           starts_at = nullif(p->>'starts_at', '')::timestamptz, ends_at = nullif(p->>'ends_at', '')::timestamptz,
           active = coalesce((p->>'active')::boolean, active)
     where id = v_id;
  end if;
  perform public._audit('site_post_save', 'site_post', v_id::text, null, p);
  return v_id;
end $$;

create or replace function public.admin_delete_site_post(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  delete from site_posts where id = p_id;
  perform public._audit('site_post_delete', 'site_post', p_id::text, null, '{}'::jsonb);
end $$;

revoke all on function public._site_posts(boolean) from public, anon, authenticated;
revoke all on function public.app_offers(), public.admin_site_posts(), public.admin_save_site_post(jsonb), public.admin_delete_site_post(bigint) from public, anon;
grant execute on function public.app_offers(), public.admin_site_posts(), public.admin_save_site_post(jsonb), public.admin_delete_site_post(bigint) to authenticated;
-- ব্যতিক্রম: ওয়েবসাইট লগইন ছাড়া পড়ে, তাই site_info anon-ও চালাতে পারে (শুধু পাবলিক তথ্য, কিছু লেখে না)
revoke all on function public.site_info() from public;
grant execute on function public.site_info() to anon, authenticated;
