-- 015: device tracking (brand/model/OS per account) + referral blocked when the new account's phone was used by another account

create table if not exists user_devices (
  user_id uuid not null references profiles(id) on delete cascade,
  device_hash text not null,
  brand text, model text, os text, app_version text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  opens int not null default 1,
  primary key (user_id, device_hash)
);
create index if not exists user_devices_hash_idx on user_devices (device_hash);
alter table user_devices enable row level security;
drop policy if exists ud_read on user_devices;
create policy ud_read on user_devices for select to authenticated using (public.is_admin());

alter table profiles add column if not exists referral_blocked text;

insert into settings (key, value, description, is_public) values
  ('referral_require_device', 'true', 'রেফার সফল হতে নতুন ইউজারকে অ্যাপ (APK) থেকে লগইন করতে হবে', true),
  ('referral_block_same_device', 'true', 'একই মোবাইলে আগে অন্য অ্যাকাউন্ট থাকলে রেফার বাতিল', true)
on conflict (key) do nothing;

create or replace function public.register_device(p_device_id text, p_brand text, p_model text, p_os text, p_app text)
returns json language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h text; others int;
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  if p_device_id is null or char_length(p_device_id) not between 6 and 128 then raise exception 'BAD_DEVICE'; end if;
  h := md5('reels-enjoy:' || p_device_id);
  insert into user_devices (user_id, device_hash, brand, model, os, app_version)
  values (u, h, left(p_brand, 40), left(p_model, 60), left(p_os, 40), left(p_app, 20))
  on conflict (user_id, device_hash) do update set last_seen = now(), opens = user_devices.opens + 1,
    brand = excluded.brand, model = excluded.model, os = excluded.os, app_version = excluded.app_version;
  select count(distinct user_id) - 1 into others from user_devices where device_hash = h;
  perform public._check_referral(u);
  return json_build_object('ok', true, 'other_accounts', others);
end $$;

create or replace function public._check_referral(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p record; views int; cnt int; t record;
        hold interval := make_interval(hours => public.setting_int('pending_hold_hours')::int);
begin
  if public.setting_text('referral_enabled') <> 'true' then return; end if;
  select * into p from profiles where id = p_user for update;
  if p.referred_by is null or p.referral_qualified_at is not null or p.referral_blocked is not null then return; end if;

  -- same phone check: this phone was used by another account (or by the referrer)
  if coalesce(public.setting_text('referral_block_same_device'), 'true') = 'true' and exists (
      select 1 from user_devices mine join user_devices other on other.device_hash = mine.device_hash and other.user_id <> mine.user_id
      where mine.user_id = p_user) then
    update profiles set referral_blocked = 'same_device' where id = p_user;
    perform public._notify(p.referred_by, 'system', '⚠️ রেফার বাতিল: @' || p.username,
      'এই মোবাইলে আগে অন্য অ্যাকাউন্ট খোলা হয়েছে, তাই এই রেফারের বোনাস দেওয়া হবে না।', '{}'::jsonb);
    return;
  end if;

  select count(*) into views from video_views where viewer_id = p_user;
  if views < public.setting_int('referral_min_views') then return; end if;
  -- must have opened the real app at least once (so the phone can be checked)
  if coalesce(public.setting_text('referral_require_device'), 'true') = 'true'
     and not exists (select 1 from user_devices where user_id = p_user) then return; end if;
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
        select p.username, p.created_at, p.referral_qualified_at is not null as qualified, p.referral_blocked as blocked,
               (select count(*) from video_views vv where vv.viewer_id = p.id) as views
        from profiles p where p.referred_by = u order by p.created_at desc limit 100) x), '[]'::json),
    'tiers', coalesce((select json_agg(json_build_object('referrals', t.referrals, 'bonus_paisa', t.bonus_paisa,
              'awarded', exists (select 1 from referral_tier_awards a where a.user_id = u and a.tier_id = t.id)) order by t.referrals)
              from referral_tiers t where t.is_active), '[]'::json)
  ) into r;
  return r;
end $$;

-- admin: devices list (shared phones first) and per-user devices
create or replace function public.admin_devices(p_only_shared boolean default false, p_user_no bigint default null)
returns table(device_hash text, brand text, model text, os text, app_version text, accounts bigint, last_seen timestamptz, users json)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  with d as (
    select ud.device_hash, count(distinct ud.user_id) as accounts, max(ud.last_seen) as last_seen
    from user_devices ud
    where p_user_no is null or ud.device_hash in (select x.device_hash from user_devices x join profiles px on px.id = x.user_id where px.user_no = p_user_no)
    group by ud.device_hash
  )
  select d.device_hash,
         (select u2.brand from user_devices u2 where u2.device_hash = d.device_hash order by u2.last_seen desc limit 1),
         (select u2.model from user_devices u2 where u2.device_hash = d.device_hash order by u2.last_seen desc limit 1),
         (select u2.os from user_devices u2 where u2.device_hash = d.device_hash order by u2.last_seen desc limit 1),
         (select u2.app_version from user_devices u2 where u2.device_hash = d.device_hash order by u2.last_seen desc limit 1),
         d.accounts, d.last_seen,
         (select json_agg(json_build_object('user_no', p.user_no, 'username', p.username, 'status', p.status, 'created_at', p.created_at,
                  'first_seen', u3.first_seen, 'last_seen', u3.last_seen, 'opens', u3.opens,
                  'referred_by', (select r.user_no from profiles r where r.id = p.referred_by),
                  'ref_blocked', p.referral_blocked, 'ref_ok', p.referral_qualified_at is not null) order by u3.first_seen)
            from user_devices u3 join profiles p on p.id = u3.user_id where u3.device_hash = d.device_hash)
  from d
  where not p_only_shared or d.accounts > 1
  order by (d.accounts > 1) desc, d.last_seen desc
  limit 300;
end $$;

create or replace function public.admin_device_stats() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return json_build_object(
    'devices', (select count(distinct device_hash) from user_devices),
    'shared', (select count(*) from (select device_hash from user_devices group by device_hash having count(distinct user_id) > 1) s),
    'blocked_refs', (select count(*) from profiles where referral_blocked is not null),
    'models', (select coalesce(json_agg(x), '[]') from (
        select coalesce(brand, '?') || ' ' || coalesce(model, '') as name, count(distinct device_hash) as devices
        from user_devices group by 1 order by 2 desc limit 15) x));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.register_device(text, text, text, text, text)', 'public.my_referrals()',
                           'public.admin_devices(boolean, bigint)', 'public.admin_device_stats()'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
