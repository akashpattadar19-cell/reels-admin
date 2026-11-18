-- 019: one-time welcome bonus for new users on their first app open (once per phone)
alter table profiles add column if not exists welcome_bonus_at timestamptz;
insert into settings (key, value, description, is_public) values
  ('welcome_bonus_enabled', 'true', 'নতুন ইউজার প্রথমবার অ্যাপ খুললে বোনাস', true),
  ('welcome_bonus_paisa', '2000', 'নতুন ইউজারের বোনাস (পয়সা, ২০০০ = ৳২০)', true),
  ('welcome_bonus_since', to_jsonb(now()::text), 'এই সময়ের পরে খোলা অ্যাকাউন্টই বোনাস পাবে', false),
  ('share_link', '"https://akashpattadar19-cell.github.io/reels-admin/get/"', 'শেয়ার করা অ্যাপ ডাউনলোড লিংক', true)
on conflict (key) do nothing;

create or replace function public._grant_welcome(p_user uuid, p_hash text) returns bigint
language plpgsql security definer set search_path = public as $$
declare p record; amt bigint := public.setting_int('welcome_bonus_paisa');
begin
  if coalesce(public.setting_text('welcome_bonus_enabled'), 'false') <> 'true' or amt <= 0 then return 0; end if;
  select * into p from profiles where id = p_user for update;
  if p.welcome_bonus_at is not null or p.role = 'admin' or p.status <> 'active' then return 0; end if;
  if p.created_at < coalesce(public.setting_text('welcome_bonus_since')::timestamptz, now()) then return 0; end if;
  -- only the first account on this phone gets it
  if exists (select 1 from user_devices where device_hash = p_hash and user_id <> p_user) then
    update profiles set welcome_bonus_at = 'epoch' where id = p_user;   -- mark as not eligible
    return 0;
  end if;
  update profiles set welcome_bonus_at = now() where id = p_user;
  perform public._wallet_move(p_user, 'earning', amt, 'welcome_bonus', 'user', null, '🎁 নতুন ইউজার বোনাস', 'welcome:' || p_user);
  perform public._notify(p_user, 'system', '🎁 স্বাগতম! আপনি ৳' || round(amt / 100.0, 2) || ' বোনাস পেয়েছেন', 'ব্যালেন্সে যোগ হয়েছে', '{}'::jsonb);
  return amt;
end $$;
revoke all on function public._grant_welcome(uuid, text) from public, anon, authenticated;

create or replace function public.register_device(p_device_id text, p_brand text, p_model text, p_os text, p_app text)
returns json language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h text; others int; bonus bigint;
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  if p_device_id is null or char_length(p_device_id) not between 6 and 128 then raise exception 'BAD_DEVICE'; end if;
  h := md5('reels-enjoy:' || p_device_id);
  insert into user_devices (user_id, device_hash, brand, model, os, app_version)
  values (u, h, left(p_brand, 40), left(p_model, 60), left(p_os, 40), left(p_app, 20))
  on conflict (user_id, device_hash) do update set last_seen = now(), opens = user_devices.opens + 1,
    brand = excluded.brand, model = excluded.model, os = excluded.os, app_version = excluded.app_version;
  select count(distinct user_id) - 1 into others from user_devices where device_hash = h;
  bonus := public._grant_welcome(u, h);
  perform public._check_referral(u);
  return json_build_object('ok', true, 'other_accounts', others, 'welcome_paisa', bonus);
end $$;
