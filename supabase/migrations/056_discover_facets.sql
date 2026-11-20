-- 056: Home ফিল্টারের দেশ/ভাষা তালিকা — যেখানে বেশি ক্রিয়েটর (active, videos_count>0), সেটা আগে
create or replace function public.discover_facets() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'countries', coalesce((select json_agg(json_build_object('cc', cc, 'n', n) order by n desc) from (
       select upper(p.country_code) cc, count(*) n from profiles p
       where p.status = 'active' and coalesce(p.videos_count,0) > 0 and p.country_code is not null and p.country_code <> ''
       group by 1) x), '[]'::json),
    'langs', coalesce((select json_agg(json_build_object('lang', language, 'n', n) order by n desc) from (
       select p.language, count(*) n from profiles p
       where p.status = 'active' and coalesce(p.videos_count,0) > 0 and p.language is not null and p.language <> ''
       group by 1) y), '[]'::json));
$$;
grant execute on function public.discover_facets() to authenticated;
revoke execute on function public.discover_facets() from anon, public;
