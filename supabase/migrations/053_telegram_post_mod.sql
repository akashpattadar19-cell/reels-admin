-- 053: ছবি / লেখা পোস্টও টেলিগ্রাম গ্রুপে (প্রকাশিত হলে ✅ ঠিক আছে / 🗑 ডিলিট, পেন্ডিং হলে Approve / Reject)
alter table public.posts add column if not exists tg_sent_at timestamptz;
update public.posts set tg_sent_at = now() where tg_sent_at is null;

create or replace function public._tg_post_action(p_admin uuid, p_id bigint, p_action text, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare st text; act text;
begin
  if not exists (select 1 from profiles where id = p_admin and role = 'admin' and status = 'active') then raise exception 'NOT_ADMIN'; end if;
  select status into st from posts where id = p_id;
  if st is null then return 'missing'; end if;
  if p_action = 'approve' then
    if st <> 'pending' then return st; end if; act := 'approve';
  elsif p_action = 'remove' then
    if st = 'pending' then act := 'reject'; elsif st = 'published' then act := 'delete'; else return st; end if;
  else raise exception 'BAD_ACTION'; end if;
  perform set_config('request.jwt.claim.sub', p_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_admin, 'role', 'authenticated')::text, true);
  perform public.admin_post_action(p_id, act, p_reason);
  return 'done';
end $$;
revoke all on function public._tg_post_action(uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public._tg_post_action(uuid,bigint,text,text) to service_role;

create or replace function public.tg_mod_cron() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from private_config where key = 'telegram_mod_chat' and value is not null and value <> '') then return; end if;
  if not exists (select 1 from videos where status = 'pending' and tg_sent_at is null and created_at < now() - interval '20 seconds')
     and not exists (select 1 from posts where status in ('pending','published') and tg_sent_at is null and created_at < now() - interval '10 seconds') then return; end if;
  perform net.http_post(
    url := 'https://smveeoykybpufhvcehjv.supabase.co/functions/v1/support-telegram',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron', (select value from private_config where key = 'tg_cron_secret')),
    body := '{"action":"mod_run"}'::jsonb, timeout_milliseconds := 60000);
end $$;
revoke all on function public.tg_mod_cron() from public, anon, authenticated;
