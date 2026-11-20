-- 051: অ্যাডমিন ইউজার ম্যাপ (অবস্থান ~১ কিমি গোল করা, শুধু অ্যাডমিন)
create or replace function public.admin_user_map(p_type text default null, p_state text default null, p_limit int default 3000)
returns table (user_no bigint, full_name text, username text, avatar_url text, state text, lat numeric, lon numeric, city text,
  country_code text, account_type text, last_seen timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  select x.user_no, x.full_name, x.username, x.avatar_url, x.st, x.last_lat, x.last_lon, x.city, x.cc, x.account_type, x.last_seen from (
    select p.user_no, p.full_name, p.username, p.avatar_url, public._user_state(p.id) st, up.last_lat, up.last_lon, up.city,
      coalesce(up.country_code, p.country_code) cc, p.account_type, up.last_seen
    from profiles p join user_private up on up.user_id = p.id
    where up.last_lat is not null and up.last_lon is not null
      and (p_type is null or p_type = '' or p_type = 'all' or (p_type = 'seller' and p.coin_seller) or (p_type = 'agent' and p.agent_status = 'approved')
           or (p_type in ('user','host') and p.account_type = p_type))
  ) x
  where p_state is null or p_state = '' or p_state = 'all' or x.st = p_state or (p_state = 'active' and x.st in ('online','live','party','call'))
  order by x.last_seen desc nulls last
  limit least(greatest(p_limit, 1), 5000);
end $$;
grant execute on function public.admin_user_map(text,text,int) to authenticated;
revoke execute on function public.admin_user_map(text,text,int) from anon, public;
