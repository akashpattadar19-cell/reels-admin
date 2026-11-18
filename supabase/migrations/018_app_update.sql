-- 018: forced in-app update (min build) + optional update (latest build), version stats for admin
insert into settings (key, value, description, is_public) values
  ('latest_app_build', '0', 'সর্বশেষ APK বিল্ড নম্বর (1.0.X-এর X)', true),
  ('min_app_build', '0', 'এর চেয়ে পুরনো APK খুলবে না — আপডেট বাধ্যতামূলক', true),
  ('apk_url', '"https://akashpattadar19-cell.github.io/reels-admin/download/Reels-Enjoy.apk"', 'নতুন APK ডাউনলোড লিংক', true),
  ('update_message', to_jsonb('নতুন ফিচার ও সমস্যার সমাধান যোগ হয়েছে। চালিয়ে যেতে আপডেট করুন।'::text), 'আপডেটের বার্তা', true)
on conflict (key) do nothing;
create or replace function public.admin_app_versions() returns table(app_version text, users bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  select coalesce(x.app_version, '?'), count(*) from (
    select distinct on (ud.user_id) ud.user_id, ud.app_version from user_devices ud order by ud.user_id, ud.last_seen desc) x
  group by 1 order by 2 desc;
end $$;
revoke all on function public.admin_app_versions() from public, anon;
grant execute on function public.admin_app_versions() to authenticated;
