-- 039: রেফার সফল হওয়ার টাস্ক (এডমিন বদলাতে পারে, ০ = সেই শর্ত বন্ধ), নির্দিষ্ট দিনের মধ্যে শেষ করতে হবে
alter table public.profiles add column if not exists referred_at timestamptz;

insert into settings (key, value, description) values
  ('ref_window_days', '3'::jsonb, 'রেফার টাস্ক শেষ করার সময় (দিন)'),
  ('ref_req_full_watch', '10'::jsonb, 'রেফার: কয়টি ভিডিও পুরো দেখতে হবে'),
  ('ref_req_likes', '10'::jsonb, 'রেফার: কয়টি লাইক'),
  ('ref_req_comments', '10'::jsonb, 'রেফার: কয়টি কমেন্ট'),
  ('ref_req_shares', '10'::jsonb, 'রেফার: কয়টি শেয়ার'),
  ('ref_req_active_days', '3'::jsonb, 'রেফার: কয় দিন অ্যাপ ব্যবহার'),
  ('ref_req_minutes_per_day', '60'::jsonb, 'রেফার: প্রতিদিন কমপক্ষে কত মিনিট'),
  ('ref_req_video_posts', '5'::jsonb, 'রেফার: কয়টি ভিডিও পোস্ট (অনুমোদিত)'),
  ('ref_req_text_posts', '3'::jsonb, 'রেফার: কয়টি টেক্সট পোস্ট'),
  ('ref_offer_text', to_jsonb(''::text), 'রেফার অফারের নোটিশ (বাংলা)'),
  ('ref_offer_text_en', to_jsonb(''::text), 'রেফার অফারের নোটিশ (English)'),
  ('ref_rules_since', to_jsonb(now()::text), 'নতুন রেফার নিয়ম কবে থেকে')
on conflict (key) do nothing;

-- একজন রেফার হওয়া ইউজারের অগ্রগতি
create or replace function public._referral_progress(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare p record; st timestamptz; en timestamptz; mins int := greatest(setting_int('ref_req_minutes_per_day'), 0);
  r jsonb; vfull int; vlikes int; vcom int; vsh int; vdays int; vvid int; vtxt int;
begin
  select * into p from profiles where id = p_user;
  if p.referred_by is null then return null; end if;
  st := greatest(coalesce(p.referred_at, p.created_at), coalesce(nullif(setting_text('ref_rules_since'), '')::timestamptz, '-infinity'::timestamptz));
  en := st + make_interval(days => greatest(setting_int('ref_window_days'), 1)::int);
  select count(*) into vfull from video_views where viewer_id = p_user and rewarded_at is not null and created_at >= st and created_at < en;
  select count(*) into vlikes from likes where user_id = p_user and created_at >= st and created_at < en;
  select count(*) into vcom from comments where user_id = p_user and coalesce(status, 'visible') <> 'deleted' and created_at >= st and created_at < en;
  select count(*) into vsh from shares where user_id = p_user and created_at >= st and created_at < en;
  select count(*) into vdays from app_usage where user_id = p_user and seconds >= mins * 60
    and day >= (st at time zone 'Asia/Dhaka')::date and day < (en at time zone 'Asia/Dhaka')::date + 1;
  select count(*) into vvid from videos where user_id = p_user and status = 'published' and created_at >= st and created_at < en;
  select count(*) into vtxt from posts where user_id = p_user and kind = 'text' and status = 'published' and created_at >= st and created_at < en;
  r := jsonb_build_object('start', st, 'end', en, 'items', jsonb_build_array(
    jsonb_build_object('k', 'full_watch', 'need', setting_int('ref_req_full_watch'), 'have', vfull),
    jsonb_build_object('k', 'likes', 'need', setting_int('ref_req_likes'), 'have', vlikes),
    jsonb_build_object('k', 'comments', 'need', setting_int('ref_req_comments'), 'have', vcom),
    jsonb_build_object('k', 'shares', 'need', setting_int('ref_req_shares'), 'have', vsh),
    jsonb_build_object('k', 'active_days', 'need', setting_int('ref_req_active_days'), 'have', vdays, 'mins', mins),
    jsonb_build_object('k', 'video_posts', 'need', setting_int('ref_req_video_posts'), 'have', vvid),
    jsonb_build_object('k', 'text_posts', 'need', setting_int('ref_req_text_posts'), 'have', vtxt)));
  return r || jsonb_build_object('done', not exists (
    select 1 from jsonb_array_elements(r->'items') x where (x->>'need')::int > 0 and (x->>'have')::int < (x->>'need')::int));
end $function$;
revoke execute on function public._referral_progress(uuid) from public, anon, authenticated;

create or replace function public._check_referral(p_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare p record; cnt int; t record; pr jsonb;
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
    -- সময় শেষ (ভিডিও অনুমোদনের জন্য আরও ৩ দিন অপেক্ষা) → বাতিল
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

  update profiles set referral_qualified_at = now() where id = p_user;
  perform public._wallet_move(p.referred_by, 'pending', public._urate(p.referred_by, 'referral_bonus_paisa'), 'referral_bonus',
                              'user', null, '@' || p.username, 'ref:' || p_user, now() + hold);
  perform public._wallet_move(p_user, 'points', public.setting_int('referral_welcome_points'), 'referral_welcome',
                              'user', null, null, 'refw:' || p_user);
  perform public._notify(p.referred_by, 'system', '🎉 রেফার সফল! @' || p.username,
                         'আপনি পাবেন ৳' || round(public._urate(p.referred_by, 'referral_bonus_paisa') / 100.0, 2), '{}'::jsonb);
  perform public._notify(p_user, 'system', '🎉 রেফারের সব টাস্ক শেষ!',
                         'আপনি পেয়েছেন ⭐ ' || public.setting_int('referral_welcome_points') || ' পয়েন্ট', '{}'::jsonb);
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

-- প্রতি ১০ মিনিটে চলমান সব রেফার যাচাই
create or replace function public.referral_cron()
returns int language plpgsql security definer set search_path to 'public' as $function$
declare r record; n int := 0;
begin
  for r in select id from profiles where referred_by is not null and referral_qualified_at is null and referral_blocked is null
           and status = 'active' limit 2000 loop
    perform public._check_referral(r.id); n := n + 1;
  end loop;
  return n;
end $function$;
revoke execute on function public.referral_cron() from public, anon, authenticated;
select cron.unschedule('referral-cron') where exists (select 1 from cron.job where jobname = 'referral-cron');
select cron.schedule('referral-cron', '*/10 * * * *', 'select public.referral_cron()');

-- set_referrer: কবে রেফার যুক্ত হল
create or replace function public.set_referrer(p_ref_no text)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare u uuid := _active_user(); me record; ref record;
begin
  select * into me from profiles where id = u;
  if me.referred_by is not null then raise exception 'REF_ALREADY'; end if;
  if me.created_at < now() - make_interval(days => greatest(setting_int('referral_add_days'), 0)::int) then raise exception 'REF_TOO_LATE'; end if;
  if coalesce(p_ref_no, '') !~ '^[0-9]{6,12}$' then raise exception 'REF_NOT_FOUND'; end if;
  select id, username, referred_by into ref from profiles where user_no = p_ref_no::bigint and status = 'active';
  if not found then raise exception 'REF_NOT_FOUND'; end if;
  if ref.id = u or ref.referred_by = u then raise exception 'REF_SELF'; end if;
  update profiles set referred_by = ref.id, referred_at = now() where id = u;
  return json_build_object('ok', true, 'username', ref.username);
end $function$;

-- রেফার হওয়া ইউজার নিজের টাস্ক দেখে
create or replace function public.my_referral_tasks()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare u uuid := public._active_user(); p record;
begin
  select referred_by, referral_qualified_at, referral_blocked into p from profiles where id = u;
  if p.referred_by is null then return null; end if;
  return public._referral_progress(u) || jsonb_build_object('qualified', p.referral_qualified_at is not null, 'blocked', p.referral_blocked,
    'referrer', (select username from profiles where id = p.referred_by));
end $function$;
revoke execute on function public.my_referral_tasks() from public, anon;
grant execute on function public.my_referral_tasks() to authenticated;

create or replace function public.my_referrals()
returns json language plpgsql stable security definer set search_path to 'public' as $function$
declare u uuid := public._active_user(); r json;
begin
  select json_build_object(
    'code', (select user_no from profiles where id = u),
    'total', (select count(*) from profiles where referred_by = u),
    'qualified', (select count(*) from profiles where referred_by = u and referral_qualified_at is not null),
    'earned_paisa', (select coalesce(sum(amount),0) from transactions where user_id = u and type in ('referral_bonus','referral_tier_bonus')),
    'min_views', public.setting_int('referral_min_views'),
    'list', coalesce((select json_agg(x order by x.created_at desc) from (
        select p.username, p.created_at, p.referral_qualified_at is not null as qualified, p.referral_blocked as blocked,
               case when p.referral_qualified_at is null and p.referral_blocked is null then public._referral_progress(p.id) end as progress
        from profiles p where p.referred_by = u order by p.created_at desc limit 100) x), '[]'::json),
    'tiers', coalesce((select json_agg(json_build_object('referrals', t.referrals, 'bonus_paisa', t.bonus_paisa,
              'awarded', exists (select 1 from referral_tier_awards a where a.user_id = u and a.tier_id = t.id)) order by t.referrals)
              from referral_tiers t where t.is_active), '[]'::json)
  ) into r;
  return r;
end $function$;

-- এডমিন: সব রেফারের তালিকা ও অগ্রগতি
create or replace function public.admin_referrals(p_status text default 'running', p_limit int default 100)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  perform _require_admin();
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
        'running', count(*) filter (where referral_qualified_at is null and referral_blocked is null),
        'done', count(*) filter (where referral_qualified_at is not null),
        'failed', count(*) filter (where referral_blocked is not null),
        'today', count(*) filter (where coalesce(referred_at, created_at) > now() - interval '1 day'))
      from profiles where referred_by is not null),
    'top', coalesce((select jsonb_agg(x) from (
        select r.user_no, r.username, count(*) total, count(*) filter (where p.referral_qualified_at is not null) done
        from profiles p join profiles r on r.id = p.referred_by group by r.user_no, r.username order by done desc, total desc limit 10) x), '[]'),
    'list', coalesce((select jsonb_agg(x) from (
        select p.user_no, p.username, coalesce(p.referred_at, p.created_at) as at, r.user_no as ref_no, r.username as ref_username,
               p.referral_qualified_at as done_at, p.referral_blocked as blocked,
               case when p.referral_qualified_at is null and p.referral_blocked is null then _referral_progress(p.id) end as progress
        from profiles p join profiles r on r.id = p.referred_by
        where case p_status when 'running' then p.referral_qualified_at is null and p.referral_blocked is null
                            when 'done' then p.referral_qualified_at is not null
                            when 'failed' then p.referral_blocked is not null else true end
        order by coalesce(p.referred_at, p.created_at) desc limit p_limit) x), '[]'));
end $function$;
revoke execute on function public.admin_referrals(text, int) from public, anon;
grant execute on function public.admin_referrals(text, int) to authenticated;
