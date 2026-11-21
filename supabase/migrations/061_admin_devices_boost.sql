-- 061: ডিভাইস পেজ থেকে রিসেট / অ্যাপ্রুভ / জেল / ডিলেট, আর অ্যাডমিন যেকোনো ভিডিও বুস্ট করতে পারে
create table if not exists device_approvals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_hash text not null,
  approved_by uuid, approved_at timestamptz not null default now()
);
alter table device_approvals enable row level security;

-- অ্যাপ্রুভ করা অ্যাকাউন্ট নিজের আলাদা "ডিভাইস কোড" পায়: সব নিয়মে তাকে আলাদা মোবাইল ধরা হয়
create or replace function public.register_device(p_device_id text, p_brand text, p_model text, p_os text, p_app text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); h text; others int; bonus bigint;
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  if p_device_id is null or char_length(p_device_id) not between 6 and 128 then raise exception 'BAD_DEVICE'; end if;
  h := md5('reels-enjoy:' || p_device_id);
  if exists (select 1 from device_approvals a where a.user_id = u and a.device_hash = h) then h := h || ':a' || left(replace(u::text, '-', ''), 8); end if;
  insert into user_devices (user_id, device_hash, brand, model, os, app_version)
  values (u, h, left(p_brand, 40), left(p_model, 60), left(p_os, 40), left(p_app, 20))
  on conflict (user_id, device_hash) do update set last_seen = now(), opens = user_devices.opens + 1,
    brand = excluded.brand, model = excluded.model, os = excluded.os, app_version = excluded.app_version;
  select count(distinct user_id) - 1 into others from user_devices where device_hash = h;
  bonus := public._grant_welcome(u, h);
  perform public._check_referral(u);
  return json_build_object('ok', true, 'other_accounts', others, 'welcome_paisa', bonus);
end $$;

drop function if exists public.admin_devices(boolean, bigint);
create function public.admin_devices(p_only_shared boolean default false, p_user_no bigint default null)
returns table(device_hash text, brand text, model text, os text, app_version text, accounts bigint, last_seen timestamptz, users json)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._require_admin();
  return query
  with ud as (select x.*, split_part(x.device_hash, ':', 1) as base from user_devices x),
  d as (
    select ud.base, count(distinct ud.user_id) as accounts,
           count(distinct ud.user_id) filter (where ud.device_hash = ud.base) as plain, max(ud.last_seen) as last_seen
    from ud
    where p_user_no is null or ud.base in (select y.base from ud y join profiles py on py.id = y.user_id where py.user_no = p_user_no)
    group by ud.base
  )
  select d.base,
         (select u2.brand from ud u2 where u2.base = d.base order by u2.last_seen desc limit 1),
         (select u2.model from ud u2 where u2.base = d.base order by u2.last_seen desc limit 1),
         (select u2.os from ud u2 where u2.base = d.base order by u2.last_seen desc limit 1),
         (select u2.app_version from ud u2 where u2.base = d.base order by u2.last_seen desc limit 1),
         d.accounts, d.last_seen,
         (select json_agg(json_build_object('id', p.id, 'user_no', p.user_no, 'username', p.username, 'status', p.status, 'created_at', p.created_at,
                  'first_seen', u3.first_seen, 'last_seen', u3.last_seen, 'opens', u3.opens,
                  'approved', u3.device_hash <> u3.base or exists (select 1 from device_approvals a where a.user_id = p.id),
                  'jailed', p.jailed,
                  'referred_by', (select r.user_no from profiles r where r.id = p.referred_by),
                  'ref_blocked', p.referral_blocked, 'ref_ok', p.referral_qualified_at is not null) order by u3.first_seen)
            from ud u3 join profiles p on p.id = u3.user_id where u3.base = d.base)
  from d
  where not p_only_shared or d.plain > 1
  order by (d.plain > 1) desc, d.last_seen desc
  limit 300;
end $$;

revoke all on function public.admin_devices(boolean, bigint) from public, anon;
grant execute on function public.admin_devices(boolean, bigint) to authenticated;

-- action: approve | unapprove | unlink (এই অ্যাকাউন্টকে মোবাইল থেকে সরান) ; p_user null + reset = পুরো মোবাইল রিসেট
create or replace function public.admin_device_action(p_device text, p_action text, p_user uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $$
declare base text := split_part(p_device, ':', 1); n int := 0; r record; ah text;
begin
  perform public._require_admin();
  if p_action = 'reset' then
    -- মোবাইলের সব রেকর্ড মুছে যায়; পরের বার যে আগে অ্যাপ খুলবে সে-ই প্রথম অ্যাকাউন্ট ধরা হবে
    for r in select distinct user_id from user_devices where split_part(device_hash, ':', 1) = base loop
      update profiles set referral_blocked = null where id = r.user_id and referral_blocked = 'same_device';
      n := n + 1;
    end loop;
    delete from user_devices where split_part(device_hash, ':', 1) = base;
    delete from device_approvals where device_hash = base;
  elsif p_user is null then raise exception 'BAD_USER';
  elsif p_action = 'approve' then
    insert into device_approvals (user_id, device_hash, approved_by) values (p_user, base, auth.uid())
      on conflict (user_id) do update set device_hash = excluded.device_hash, approved_by = excluded.approved_by, approved_at = now();
    update user_devices set device_hash = base || ':a' || left(replace(p_user::text, '-', ''), 8)
      where user_id = p_user and device_hash = base
        and not exists (select 1 from user_devices z where z.user_id = p_user and z.device_hash = base || ':a' || left(replace(p_user::text, '-', ''), 8));
    delete from user_devices where user_id = p_user and device_hash = base;
    update profiles set referral_blocked = null where id = p_user and referral_blocked = 'same_device';
    perform public._check_referral(p_user);
    n := 1;
  elsif p_action = 'unapprove' then
    delete from device_approvals where user_id = p_user;
    update user_devices set device_hash = base where user_id = p_user and split_part(device_hash, ':', 1) = base and device_hash <> base
      and not exists (select 1 from user_devices z where z.user_id = p_user and z.device_hash = base);
    delete from user_devices where user_id = p_user and split_part(device_hash, ':', 1) = base and device_hash <> base;
    n := 1;
  elsif p_action = 'unlink' then
    delete from user_devices where user_id = p_user and split_part(device_hash, ':', 1) = base;
    delete from device_approvals where user_id = p_user;
    update profiles set referral_blocked = null where id = p_user and referral_blocked = 'same_device';
    n := 1;
  else raise exception 'BAD_ACTION';
  end if;
  perform public._audit('device_' || p_action, 'device', base, coalesce(p_user::text, ''), '{}'::jsonb);
  return json_build_object('ok', true, 'accounts', n);
end $$;
revoke all on function public.admin_device_action(text, text, uuid) from public, anon;
grant execute on function public.admin_device_action(text, text, uuid) to authenticated;

-- অ্যাডমিন বিনা কয়েনে যেকোনো প্রকাশিত ভিডিও বুস্ট করতে পারে (p_days 0 = বুস্ট বন্ধ)
create or replace function public.admin_boost_video(p_id bigint, p_days numeric)
returns timestamptz language plpgsql security definer set search_path to 'public' as $$
declare t timestamptz;
begin
  perform public._require_admin();
  if p_days is null or p_days < 0 or p_days > 365 then raise exception 'BAD_DAYS'; end if;
  if p_days = 0 then update videos set boost_until = null where id = p_id;
  else
    update videos set boost_until = greatest(coalesce(boost_until, now()), now()) + make_interval(secs => (p_days * 86400)::int)
      where id = p_id and status = 'published' returning boost_until into t;
    if t is null then raise exception 'NOT_PUBLISHED'; end if;
  end if;
  perform public._audit('video_boost', 'video', p_id::text, p_days::text, '{}'::jsonb);
  return t;
end $$;
revoke all on function public.admin_boost_video(bigint, numeric) from public, anon;
grant execute on function public.admin_boost_video(bigint, numeric) to authenticated;
