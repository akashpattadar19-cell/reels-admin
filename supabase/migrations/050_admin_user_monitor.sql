-- 050: অ্যাডমিন ইউজার মনিটর (Keeta-র মতো লাইভ তালিকা: অনলাইন/লাইভ/কল/অফলাইন/সীমাবদ্ধ)
create or replace function public.track_time(p_sec integer) returns void
language sql security definer set search_path = public as $$
  insert into app_usage (user_id, day, seconds)
  select auth.uid(), public.today_bd(), least(greatest(coalesce(p_sec, 0), 0), 120) where auth.uid() is not null
  on conflict (user_id, day) do update set seconds = least(app_usage.seconds + excluded.seconds, 86400);
  update user_private set last_seen = now() where user_id = auth.uid();
$$;

create or replace function public._user_state(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.status <> 'active' or coalesce(p.jailed, false) or coalesce(w.is_frozen, false) then 'restricted'
    when exists (select 1 from live_rooms l where l.host_id = p.id and l.status = 'live' and l.kind = 'party') then 'party'
    when exists (select 1 from live_rooms l where l.host_id = p.id and l.status = 'live') then 'live'
    when exists (select 1 from calls c where (c.caller_id = p.id or c.callee_id = p.id) and c.status in ('active','ringing')) then 'call'
    when up.last_seen > now() - interval '3 minutes' then 'online'
    else 'offline' end
  from profiles p left join user_private up on up.user_id = p.id left join wallets w on w.user_id = p.id
  where p.id = p_user;
$$;
revoke all on function public._user_state(uuid) from public, anon, authenticated;

create or replace function public.admin_user_monitor(p_q text default null, p_state text default null, p_type text default null,
  p_sort text default 'recent', p_limit int default 50, p_offset int default 0)
returns table (id uuid, user_no bigint, username text, full_name text, avatar_url text, phone text, country_code text, city text,
  account_type text, coin_seller boolean, role text, status text, state text, last_seen timestamptz, today_seconds int,
  videos_count int, followers_count int, coin_balance bigint, earning_paisa bigint, vip boolean, agent boolean,
  created_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  with b as (
    select p.*, up.phone as ph, coalesce(up.country_code, p.country_code) as cc, up.city as ct, up.last_seen as ls,
      coalesce(au.seconds, 0) as tsec, w.coin_balance as cb, w.earning_paisa as ep, public._user_state(p.id) as st
    from profiles p
    left join user_private up on up.user_id = p.id
    left join wallets w on w.user_id = p.id
    left join app_usage au on au.user_id = p.id and au.day = public.today_bd()
    where (p_q is null or p_q = '' or p.username ilike '%' || p_q || '%' or p.full_name ilike '%' || p_q || '%'
           or up.phone like '%' || p_q || '%' or p.user_no::text = p_q)
      and (p_type is null or p_type = '' or (p_type = 'seller' and p.coin_seller) or (p_type = 'agent' and p.agent_status = 'approved')
           or (p_type in ('user','host') and p.account_type = p_type))
  )
  select b.id, b.user_no, b.username, b.full_name, b.avatar_url, b.ph, b.cc, b.ct, b.account_type, b.coin_seller, b.role, b.status, b.st,
    b.ls, b.tsec, b.videos_count, b.followers_count, b.cb, b.ep, coalesce(b.vip_until > now(), false), coalesce(b.agent_status = 'approved', false),
    b.created_at, count(*) over ()
  from b
  where p_state is null or p_state = '' or p_state = 'all' or b.st = p_state
     or (p_state = 'active' and b.st in ('online','live','party','call'))
  order by
    case when p_sort = 'name' then lower(coalesce(nullif(b.full_name, ''), b.username)) end asc,
    case when p_sort = 'time' then b.tsec end desc,
    case when p_sort = 'coins' then b.cb end desc,
    case when p_sort = 'seen' then b.ls end desc nulls last,
    case b.st when 'live' then 0 when 'party' then 1 when 'call' then 2 when 'online' then 3 when 'offline' then 4 else 5 end,
    b.ls desc nulls last, b.created_at desc
  limit p_limit offset p_offset;
end $$;

create or replace function public.admin_user_state_counts(p_type text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public._require_admin();
  select jsonb_object_agg(st, n) || jsonb_build_object('all', sum(n)) into r from (
    select public._user_state(p.id) st, count(*) n from profiles p
    where (p_type is null or p_type = '' or (p_type = 'seller' and p.coin_seller) or (p_type = 'agent' and p.agent_status = 'approved')
           or (p_type in ('user','host') and p.account_type = p_type))
    group by 1) x;
  return coalesce(r, '{}'::jsonb);
end $$;
grant execute on function public.admin_user_monitor(text,text,text,text,int,int), public.admin_user_state_counts(text) to authenticated;
revoke execute on function public.admin_user_monitor(text,text,text,text,int,int), public.admin_user_state_counts(text) from anon, public;
