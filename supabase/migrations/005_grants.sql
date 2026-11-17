-- লগইন ছাড়া কেউ কোনো ফাংশন কল করতে পারবে না
alter function public.today_bd() set search_path = public;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- ভেতরের সাহায্যকারী ফাংশন: অ্যাপ থেকে সরাসরি নয়
revoke execute on function public._active_user(), public._require_admin(), public.follow_counts(),
  public.handle_new_user(), public.setting_int(text), public.setting_text(text),
  public.username_available(text) from authenticated;
grant execute on function public.username_available(text) to service_role;

-- ভবিষ্যতে নতুন ফাংশনও ডিফল্টে anon পাবে না
alter default privileges in schema public revoke execute on functions from public, anon;

-- এই দুটো টেবিল শুধু ফাংশনের ভেতর থেকে ব্যবহৃত হয় (কোনো policy = কেউ সরাসরি পড়তে পারবে না)
comment on table public.like_rewards is 'internal: only accessed by security definer functions';
comment on table public.comment_rewards is 'internal: only accessed by security definer functions';
