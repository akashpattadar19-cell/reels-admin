-- 063: ডিভাইস পেজ থেকে "ডিলেট" = ব্যান (পোস্ট ও নাম থাকে, অ্যাকাউন্ট ব্যবহার করা যায় না)।
-- ব্যান হওয়া অ্যাকাউন্টের মোবাইল রেকর্ড আলাদা কোডে সরে যায় (<base>:x<uid8>), তাই ওই মোবাইলে
-- পরে খোলা প্রথম নতুন অ্যাকাউন্টটি "প্রথম অ্যাকাউন্ট" ধরা হয় আর তার রেফার চলে; পরের অ্যাকাউন্টগুলো আগের মতোই বাতিল।
create or replace function public.register_device(p_device_id text, p_brand text, p_model text, p_os text, p_app text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); h text; others int; bonus bigint; st text;
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  if p_device_id is null or char_length(p_device_id) not between 6 and 128 then raise exception 'BAD_DEVICE'; end if;
  h := md5('reels-enjoy:' || p_device_id);
  select status into st from profiles where id = u;
  if st = 'banned' then h := h || ':x' || left(replace(u::text, '-', ''), 8);
  elsif exists (select 1 from device_approvals a where a.user_id = u and a.device_hash = h) then h := h || ':a' || left(replace(u::text, '-', ''), 8); end if;
  insert into user_devices (user_id, device_hash, brand, model, os, app_version)
  values (u, h, left(p_brand, 40), left(p_model, 60), left(p_os, 40), left(p_app, 20))
  on conflict (user_id, device_hash) do update set last_seen = now(), opens = user_devices.opens + 1,
    brand = excluded.brand, model = excluded.model, os = excluded.os, app_version = excluded.app_version;
  if st = 'banned' then return json_build_object('ok', false, 'banned', true); end if;
  select count(distinct user_id) - 1 into others from user_devices where device_hash = h;
  bonus := public._grant_welcome(u, h);
  perform public._check_referral(u);
  return json_build_object('ok', true, 'other_accounts', others, 'welcome_paisa', bonus);
end $$;

create or replace function public._device_move(p_user uuid, p_base text, p_suffix text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare nh text := p_base || p_suffix;
begin
  update user_devices set device_hash = nh where user_id = p_user and split_part(device_hash, ':', 1) = p_base and device_hash <> nh
    and not exists (select 1 from user_devices z where z.user_id = p_user and z.device_hash = nh);
  delete from user_devices where user_id = p_user and split_part(device_hash, ':', 1) = p_base and device_hash <> nh;
end $$;
revoke all on function public._device_move(uuid, text, text) from public, anon, authenticated;

create or replace function public.admin_device_action(p_device text, p_action text, p_user uuid default null, p_reason text default null)
returns json language plpgsql security definer set search_path to 'public' as $$
declare base text := split_part(p_device, ':', 1); n int := 0; r record; tag text;
begin
  perform public._require_admin();
  if p_action = 'reset' then
    for r in select distinct user_id from user_devices where split_part(device_hash, ':', 1) = base loop
      update profiles set referral_blocked = null where id = r.user_id and referral_blocked = 'same_device';
      n := n + 1;
    end loop;
    delete from user_devices where split_part(device_hash, ':', 1) = base;
    delete from device_approvals where device_hash = base;
    perform public._audit('device_reset', 'device', base, '');
    return json_build_object('ok', true, 'accounts', n);
  end if;
  if p_user is null then raise exception 'BAD_USER'; end if;
  tag := left(replace(p_user::text, '-', ''), 8);
  if p_action = 'approve' then
    insert into device_approvals (user_id, device_hash, approved_by) values (p_user, base, auth.uid())
      on conflict (user_id) do update set device_hash = excluded.device_hash, approved_by = excluded.approved_by, approved_at = now();
    perform public._device_move(p_user, base, ':a' || tag);
    update profiles set referral_blocked = null where id = p_user and referral_blocked = 'same_device';
    perform public._check_referral(p_user);
  elsif p_action = 'unapprove' then
    delete from device_approvals where user_id = p_user;
    perform public._device_move(p_user, base, '');
  elsif p_action = 'ban' then
    if p_user = auth.uid() then raise exception 'SELF'; end if;
    update profiles set status = 'banned', ban_reason = coalesce(nullif(p_reason, ''), 'একই মোবাইলে একাধিক অ্যাকাউন্ট') where id = p_user;
    delete from device_approvals where user_id = p_user;
    perform public._device_move(p_user, base, ':x' || tag);
    delete from push_tokens where user_id = p_user;
    -- এই মোবাইলের বাকি অ্যাকাউন্টগুলোর রেফার আবার যাচাই (এখন যে প্রথম, সে পাবে)
    for r in select distinct user_id from user_devices where device_hash = base loop
      if public._device_primary(r.user_id) then
        update profiles set referral_blocked = null where id = r.user_id and referral_blocked = 'same_device';
        perform public._check_referral(r.user_id);
      end if;
    end loop;
  elsif p_action = 'unban' then
    update profiles set status = 'active', ban_reason = null where id = p_user;
    perform public._device_move(p_user, base, '');
  else raise exception 'BAD_ACTION';
  end if;
  perform public._audit('device_' || p_action, 'device', base, p_user::text);
  return json_build_object('ok', true);
end $$;
drop function if exists public.admin_device_action(text, text, uuid);
revoke all on function public.admin_device_action(text, text, uuid, text) from public, anon;
grant execute on function public.admin_device_action(text, text, uuid, text) to authenticated;

-- তালিকায় ব্যান/অ্যাপ্রুভ আলাদা করে দেখানো
create or replace function public.admin_devices(p_only_shared boolean default false, p_user_no bigint default null)
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
                  'approved', u3.device_hash like '%:a%', 'primary', u3.device_hash = u3.base and public._device_primary(p.id),
                  'jailed', p.jailed,
                  'referred_by', (select r.user_no from profiles r where r.id = p.referred_by),
                  'ref_blocked', p.referral_blocked, 'ref_ok', p.referral_qualified_at is not null) order by u3.first_seen)
            from ud u3 join profiles p on p.id = u3.user_id where u3.base = d.base)
  from d
  where not p_only_shared or d.plain > 1
  order by (d.plain > 1) desc, d.last_seen desc
  limit 300;
end $$;

-- _check_referral: same_device block only when another account used the phone earlier
-- (applied via replace on the live definition: "where mine.user_id = p_user" → "where mine.user_id = p_user and other.first_seen < mine.first_seen")
