-- 044: এজেন্ট প্রোগ্রাম — ইউজার আবেদন করে, অ্যাডমিন অনুমোদন দেয়; এজেন্টের নিজস্ব লিংক/কোড;
-- এজেন্টের রেফারদের আলাদা (কঠিন) টাস্ক: N দিন অ্যাপ ব্যবহার, প্রতিদিন X ফটো + Y লেখা + Z ভিডিও পোস্ট, আর অন্যদের ভিডিও পুরো দেখা/লাইক/কমেন্ট/শেয়ার।
-- প্রতি সফল রেফারে agent_ref_bonus_paisa, প্রতি agent_target_refs জনে agent_target_bonus_paisa (বারবার)।
alter table profiles add column if not exists agent_status text check (agent_status in ('pending', 'approved', 'rejected'));
alter table profiles add column if not exists agent_applied_at timestamptz;
alter table profiles add column if not exists agent_since timestamptz;
alter table profiles add column if not exists agent_note text;
alter table profiles add column if not exists ref_agent boolean not null default false;

insert into settings (key, value, description) values
  ('agent_enabled', 'true', 'এজেন্ট আবেদন চালু'),
  ('agent_auto_approve', 'false', 'এজেন্ট আবেদন অটো অনুমোদন'),
  ('agent_window_days', '7', 'এজেন্টের রেফার কত দিনের মধ্যে টাস্ক শেষ করবে'),
  ('agent_req_active_days', '7', 'এজেন্টের রেফার: কত দিন অ্যাপ ব্যবহার'),
  ('agent_req_minutes_per_day', '20', 'এজেন্টের রেফার: প্রতিদিন কমপক্ষে কত মিনিট'),
  ('agent_req_photo_per_day', '2', 'এজেন্টের রেফার: প্রতিদিন কয়টি ফটো পোস্ট'),
  ('agent_req_text_per_day', '3', 'এজেন্টের রেফার: প্রতিদিন কয়টি লেখা পোস্ট'),
  ('agent_req_video_per_day', '4', 'এজেন্টের রেফার: প্রতিদিন কয়টি ভিডিও পোস্ট'),
  ('agent_req_post_days', '7', 'এজেন্টের রেফার: কত দিন দৈনিক পোস্টের টাস্ক পূরণ করবে'),
  ('agent_req_full_watch', '10', 'এজেন্টের রেফার: অন্যদের কয়টি ভিডিও পুরো দেখবে'),
  ('agent_req_likes', '10', 'এজেন্টের রেফার: কয়টি লাইক'),
  ('agent_req_comments', '10', 'এজেন্টের রেফার: কয়টি কমেন্ট'),
  ('agent_req_shares', '10', 'এজেন্টের রেফার: কয়টি শেয়ার'),
  ('agent_ref_bonus_paisa', '4000', 'এজেন্ট প্রতি সফল রেফারে পাবে'),
  ('agent_target_refs', '20', 'এজেন্ট টার্গেট: কতজন সফল রেফার'),
  ('agent_target_bonus_paisa', '20000', 'প্রতি টার্গেট পূরণে বাড়তি বোনাস'),
  ('agent_rules_text', '"এজেন্টরা নিজের লিংক বা কোড দিয়ে নতুন মানুষ আনবেন। ভুয়া অ্যাকাউন্ট, একই মোবাইলে একাধিক অ্যাকাউন্ট বা জোর করে কাউকে আনলে এজেন্ট পদ বাতিল হবে।"', 'এজেন্টের নিয়মের নোটিশ'),
  ('agent_rules_text_en', '"Agents bring new people with their own link or code. Fake accounts, several accounts on one phone or pressuring people cancel the agent role."', 'Agent rules notice (English)')
on conflict (key) do nothing;

-- রেফার হওয়ার মুহূর্তে রেফারকারী অনুমোদিত এজেন্ট হলে এটা "এজেন্ট রেফার"
create or replace function public._tg_ref_agent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.referred_by is not null and (tg_op = 'INSERT' or old.referred_by is distinct from new.referred_by) then
    new.ref_agent := exists (select 1 from profiles a where a.id = new.referred_by and a.agent_status = 'approved');
  end if;
  return new;
end $$;
drop trigger if exists tg_ref_agent on profiles;
create trigger tg_ref_agent before insert or update of referred_by on profiles for each row execute function public._tg_ref_agent();

create or replace function public._referral_progress(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p record; st timestamptz; en timestamptz; ag boolean; pre text; mins int;
  r jsonb; vfull int; vlikes int; vcom int; vsh int; vdays int; vvid int; vtxt int; dph int; dtx int; dvd int; d0 date; d1 date;
begin
  select * into p from profiles where id = p_user;
  if p.referred_by is null then return null; end if;
  ag := coalesce(p.ref_agent, false);
  pre := case when ag then 'agent_' else 'ref_' end;
  mins := greatest(setting_int(pre || 'req_minutes_per_day'), 0);
  st := coalesce(p.referred_at, p.created_at);
  if not ag then st := greatest(st, coalesce(nullif(setting_text('ref_rules_since'), '')::timestamptz, '-infinity'::timestamptz)); end if;
  en := st + make_interval(days => greatest(setting_int(case when ag then 'agent_window_days' else 'ref_window_days' end), 1)::int);
  d0 := (st at time zone 'Asia/Dhaka')::date; d1 := (en at time zone 'Asia/Dhaka')::date;
  select count(*) into vfull from video_views where viewer_id = p_user and rewarded_at is not null and created_at >= st and created_at < en;
  select count(*) into vlikes from likes where user_id = p_user and created_at >= st and created_at < en;
  select count(*) into vcom from comments where user_id = p_user and coalesce(status, 'visible') <> 'deleted' and created_at >= st and created_at < en;
  select count(*) into vsh from shares where user_id = p_user and created_at >= st and created_at < en;
  select count(*) into vdays from app_usage where user_id = p_user and seconds >= mins * 60 and day >= d0 and day < d1 + 1;
  if not ag then
    select count(*) into vvid from videos where user_id = p_user and status = 'published' and created_at >= st and created_at < en;
    select count(*) into vtxt from posts where user_id = p_user and kind = 'text' and status = 'published' and created_at >= st and created_at < en;
    r := jsonb_build_object('start', st, 'end', en, 'agent', false, 'items', jsonb_build_array(
      jsonb_build_object('k', 'full_watch', 'need', setting_int('ref_req_full_watch'), 'have', vfull),
      jsonb_build_object('k', 'likes', 'need', setting_int('ref_req_likes'), 'have', vlikes),
      jsonb_build_object('k', 'comments', 'need', setting_int('ref_req_comments'), 'have', vcom),
      jsonb_build_object('k', 'shares', 'need', setting_int('ref_req_shares'), 'have', vsh),
      jsonb_build_object('k', 'active_days', 'need', setting_int('ref_req_active_days'), 'have', vdays, 'mins', mins),
      jsonb_build_object('k', 'video_posts', 'need', setting_int('ref_req_video_posts'), 'have', vvid),
      jsonb_build_object('k', 'text_posts', 'need', setting_int('ref_req_text_posts'), 'have', vtxt)));
  else
    -- দৈনিক পোস্ট: যত দিন প্রতিদিনের সংখ্যা পূরণ হয়েছে (বাংলাদেশ সময়ের দিন ধরে)
    select count(*) into dph from (select (created_at at time zone 'Asia/Dhaka')::date d from posts
      where user_id = p_user and kind = 'photo' and status <> 'rejected' and created_at >= st and created_at < en group by 1
      having count(*) >= greatest(setting_int('agent_req_photo_per_day'), 1)) x;
    select count(*) into dtx from (select (created_at at time zone 'Asia/Dhaka')::date d from posts
      where user_id = p_user and kind = 'text' and status <> 'rejected' and created_at >= st and created_at < en group by 1
      having count(*) >= greatest(setting_int('agent_req_text_per_day'), 1)) x;
    select count(*) into dvd from (select (created_at at time zone 'Asia/Dhaka')::date d from videos
      where user_id = p_user and status <> 'rejected' and created_at >= st and created_at < en group by 1
      having count(*) >= greatest(setting_int('agent_req_video_per_day'), 1)) x;
    r := jsonb_build_object('start', st, 'end', en, 'agent', true, 'items', jsonb_build_array(
      jsonb_build_object('k', 'active_days', 'need', setting_int('agent_req_active_days'), 'have', vdays, 'mins', mins),
      jsonb_build_object('k', 'photo_days', 'need', case when setting_int('agent_req_photo_per_day') > 0 then setting_int('agent_req_post_days') else 0 end, 'have', dph, 'per', setting_int('agent_req_photo_per_day')),
      jsonb_build_object('k', 'text_days', 'need', case when setting_int('agent_req_text_per_day') > 0 then setting_int('agent_req_post_days') else 0 end, 'have', dtx, 'per', setting_int('agent_req_text_per_day')),
      jsonb_build_object('k', 'video_days', 'need', case when setting_int('agent_req_video_per_day') > 0 then setting_int('agent_req_post_days') else 0 end, 'have', dvd, 'per', setting_int('agent_req_video_per_day')),
      jsonb_build_object('k', 'full_watch', 'need', setting_int('agent_req_full_watch'), 'have', vfull),
      jsonb_build_object('k', 'likes', 'need', setting_int('agent_req_likes'), 'have', vlikes),
      jsonb_build_object('k', 'comments', 'need', setting_int('agent_req_comments'), 'have', vcom),
      jsonb_build_object('k', 'shares', 'need', setting_int('agent_req_shares'), 'have', vsh)));
  end if;
  return r || jsonb_build_object('done', not exists (
    select 1 from jsonb_array_elements(r->'items') x where (x->>'need')::int > 0 and (x->>'have')::int < (x->>'need')::int));
end $function$;

create or replace function public._check_referral(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p record; cnt int; t record; pr jsonb; bonus bigint; tgt int; acnt int;
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
  update profiles set referral_qualified_at = now() where id = p_user;
  bonus := case when p.ref_agent then public.setting_int('agent_ref_bonus_paisa')::bigint else public._urate(p.referred_by, 'referral_bonus_paisa') end;
  perform public._wallet_move(p.referred_by, 'pending', bonus, 'referral_bonus', 'user', null, '@' || p.username, 'ref:' || p_user, now() + hold);
  perform public._wallet_move(p_user, 'points', public.setting_int('referral_welcome_points'), 'referral_welcome',
                              'user', null, null, 'refw:' || p_user);
  perform public._notify(p.referred_by, 'system', '🎉 রেফার সফল! @' || p.username, 'আপনি পাবেন ৳' || round(bonus / 100.0, 2), '{}'::jsonb);
  perform public._notify(p_user, 'system', '🎉 রেফারের সব টাস্ক শেষ!',
                         'আপনি পেয়েছেন ⭐ ' || public.setting_int('referral_welcome_points') || ' পয়েন্ট', '{}'::jsonb);
  -- এজেন্ট টার্গেট: প্রতি agent_target_refs জন সফল এজেন্ট-রেফারে বাড়তি বোনাস
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

-- ইউজার: আবেদন
create or replace function public.agent_apply(p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); st text; auto boolean := public.setting_text('agent_auto_approve') = 'true';
begin
  if public.setting_text('agent_enabled') <> 'true' then raise exception 'AGENT_OFF'; end if;
  select agent_status into st from profiles where id = u;
  if st in ('pending', 'approved') then return st; end if;
  update profiles set agent_status = case when auto then 'approved' else 'pending' end, agent_applied_at = now(),
         agent_since = case when auto then now() end, agent_note = left(nullif(trim(p_note), ''), 300)
   where id = u;
  return case when auto then 'approved' else 'pending' end;
end $$;

-- ইউজার: এজেন্ট ড্যাশবোর্ড
create or replace function public.my_agent() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public._active_user(); p record; q int; tgt int := greatest(public.setting_int('agent_target_refs'), 0);
begin
  select * into p from profiles where id = u;
  select count(*) into q from profiles where referred_by = u and ref_agent and referral_qualified_at is not null;
  return jsonb_build_object('status', p.agent_status, 'applied_at', p.agent_applied_at, 'since', p.agent_since, 'code', p.user_no,
    'total', (select count(*) from profiles where referred_by = u and ref_agent),
    'running', (select count(*) from profiles where referred_by = u and ref_agent and referral_qualified_at is null and referral_blocked is null),
    'qualified', q, 'failed', (select count(*) from profiles where referred_by = u and ref_agent and referral_blocked is not null),
    'target', tgt, 'target_left', case when tgt > 0 then tgt - (q % tgt) end,
    'earned_paisa', (select coalesce(sum(t.amount), 0) from transactions t where t.user_id = u and (t.type = 'agent_target_bonus'
                      or (t.type = 'referral_bonus' and exists (select 1 from profiles r where r.referred_by = u and r.ref_agent and t.idem_key = 'ref:' || r.id)))),
    'list', case when p.agent_status = 'approved' then coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select r.username, r.full_name, r.avatar_url, r.created_at, r.referral_qualified_at is not null as qualified, r.referral_blocked as blocked,
               case when r.referral_qualified_at is null and r.referral_blocked is null then public._referral_progress(r.id) end as progress
          from profiles r where r.referred_by = u and r.ref_agent order by r.created_at desc limit 100) x), '[]') else '[]' end);
end $$;

-- অ্যাডমিন
create or replace function public.admin_agents(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'counts', (select jsonb_build_object('pending', count(*) filter (where agent_status = 'pending'), 'approved', count(*) filter (where agent_status = 'approved'),
                 'rejected', count(*) filter (where agent_status = 'rejected')) from profiles),
    'list', coalesce((select jsonb_agg(x order by x.applied_at desc) from (
      select p.id, p.user_no, p.username, p.full_name, p.avatar_url, p.country_code, p.agent_status status, p.agent_applied_at applied_at,
             p.agent_since since, p.agent_note note, p.followers_count, p.videos_count, p.created_at,
             (select count(*) from profiles r where r.referred_by = p.id and r.ref_agent) total,
             (select count(*) from profiles r where r.referred_by = p.id and r.ref_agent and r.referral_qualified_at is not null) qualified,
             (select count(*) from profiles r where r.referred_by = p.id and r.ref_agent and r.referral_qualified_at is null and r.referral_blocked is null) running,
             (select count(*) from profiles r where r.referred_by = p.id and r.ref_agent and r.referral_blocked is not null) failed,
             (select count(*) from profiles r where r.referred_by = p.id and r.ref_agent and r.referral_blocked = 'same_device') same_device,
             exists (select 1 from user_devices d1 join user_devices d2 on d2.device_hash = d1.device_hash and d2.user_id <> d1.user_id where d1.user_id = p.id) shared_device
        from profiles p where p.agent_status is not null and (p_status = 'all' or p.agent_status = p_status)
        order by p.agent_applied_at desc limit 200) x), '[]'));
end $$;

create or replace function public.admin_agent_action(p_user uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  perform public._require_admin();
  if p_action = 'approve' then
    update profiles set agent_status = 'approved', agent_since = coalesce(agent_since, now()), agent_applied_at = coalesce(agent_applied_at, now()) where id = p_user;
    perform public._notify(p_user, 'system', '🎉 আপনি এখন Reels Enjoy এজেন্ট!', 'অ্যাপে "এজেন্ট" পেজে আপনার লিংক ও কোড দেখুন', jsonb_build_object('route', '#agent'));
  elsif p_action = 'reject' then
    update profiles set agent_status = 'rejected', agent_since = null where id = p_user;
    perform public._notify(p_user, 'system', 'এজেন্ট আবেদন গ্রহণ হয়নি', coalesce(nullif(trim(p_note), ''), 'পরে আবার আবেদন করতে পারেন'), '{}'::jsonb);
  elsif p_action = 'remove' then
    update profiles set agent_status = null, agent_since = null where id = p_user;
  else
    raise exception 'BAD_ACTION';
  end if;
  perform public._audit('agent_' || p_action, 'user', p_user::text, p_note, '{}'::jsonb);
end $$;

revoke all on function public._tg_ref_agent() from public, anon, authenticated;
revoke all on function public.agent_apply(text), public.my_agent(), public.admin_agents(text), public.admin_agent_action(uuid, text, text) from public, anon;
grant execute on function public.agent_apply(text), public.my_agent(), public.admin_agents(text), public.admin_agent_action(uuid, text, text) to authenticated;

-- ওয়েবসাইটে এজেন্টের নিয়ম দেখাতে site_info()-এর সেটিংস তালিকায় agent_* যোগ (প্রয়োগ করা হয়েছে DO ব্লকে replace দিয়ে)
do $$
declare d text := pg_get_functiondef('public.site_info()'::regprocedure);
begin
  if position('agent_enabled' in d) > 0 then return; end if;
  d := replace(d, '''vip_enabled'', ''store_enabled'', ''downloads_enabled'', ''dm_enabled'');',
    '''vip_enabled'', ''store_enabled'', ''downloads_enabled'', ''dm_enabled'', ''agent_enabled'', ''agent_ref_bonus_paisa'', ''agent_target_refs'', ''agent_target_bonus_paisa'', ''agent_window_days'', ''agent_req_active_days'', ''agent_req_minutes_per_day'', ''agent_req_post_days'', ''agent_req_photo_per_day'', ''agent_req_text_per_day'', ''agent_req_video_per_day'', ''agent_req_full_watch'', ''agent_req_likes'', ''agent_req_comments'', ''agent_req_shares'');');
  execute d;
end $$;
