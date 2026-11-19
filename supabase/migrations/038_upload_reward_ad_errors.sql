-- 038: ভিডিও অনুমোদনে আপলোডারকে কয়েন পুরস্কার + ভিডিও শুধু এডমিন দেখে অনুমোদন করবে + অ্যাড লোড না হওয়ার কারণ লগ
insert into settings (key, value, description) values
  ('upload_reward_coins', '10'::jsonb, 'ভিডিও অনুমোদন হলে আপলোডার কত কয়েন পাবে (০ = বন্ধ)')
on conflict (key) do nothing;
update settings set value = '0'::jsonb, updated_at = now() where key = 'auto_approve_minutes';

alter table public.videos add column if not exists reward_coins int;

create or replace function public.admin_video_action(p_id bigint, p_action text, p_reason text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v record; rc int := greatest(coalesce(public.setting_int('upload_reward_coins'), 0), 0);
begin
  perform public._require_admin();
  select * into v from videos where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action = 'approve' then
    update videos set status = 'published', approved_at = now(), reject_reason = null where id = p_id;
    if v.status in ('rejected','deleted') then update profiles set videos_count = videos_count + 1 where id = v.user_id; end if;
    -- আপলোড পুরস্কার: প্রতিটা ভিডিওতে একবার, এডমিন অনুমোদন করলে
    if rc > 0 and v.reward_coins is null and v.status <> 'published' then
      perform public._wallet_move(v.user_id, 'coin', rc, 'upload_reward', 'video', p_id, null, 'upload:' || p_id);
      update videos set reward_coins = rc where id = p_id;
      perform public._notify(v.user_id, 'system', 'আপনার ভিডিও প্রকাশিত হয়েছে ✅', '🪙 +' || rc || ' কয়েন পুরস্কার পেয়েছেন', json_build_object('video_id', p_id)::jsonb);
    else
      perform public._notify(v.user_id, 'system', 'আপনার ভিডিও প্রকাশিত হয়েছে ✅', null, json_build_object('video_id', p_id)::jsonb);
    end if;
  elsif p_action = 'feature' then
    update videos set is_featured = true where id = p_id;
  elsif p_action = 'unfeature' then
    update videos set is_featured = false where id = p_id;
  elsif p_action in ('reject','delete') then
    update videos set status = case when p_action = 'reject' then 'rejected' else 'deleted' end, reject_reason = p_reason where id = p_id;
    if v.status in ('published','pending') then
      update profiles set videos_count = greatest(videos_count - 1, 0) where id = v.user_id;
    end if;
    perform public._notify(v.user_id, 'system', 'আপনার একটি ভিডিও সরানো হয়েছে',
                           coalesce('কারণ: ' || p_reason, null), json_build_object('video_id', p_id)::jsonb);
  elsif p_action = 'restore' then
    update videos set status = 'published', reject_reason = null, approved_at = now() where id = p_id;
    if v.status not in ('published','pending') then update profiles set videos_count = videos_count + 1 where id = v.user_id; end if;
  else
    raise exception 'BAD_ACTION';
  end if;
  perform public._audit('video_' || p_action, 'video', p_id::text, p_reason, '{}'::jsonb);
end $function$;

-- অ্যাড লোড/দেখাতে ব্যর্থ হলে কারণ (অ্যাপ থেকে), এডমিন অ্যাড পেজে দেখে
create table if not exists public.ad_errors (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,
  placement text, code int, message text, app_build int,
  created_at timestamptz not null default now()
);
create index if not exists ad_errors_time on public.ad_errors(created_at desc);
alter table public.ad_errors enable row level security;
drop policy if exists ad_errors_admin on public.ad_errors;
create policy ad_errors_admin on public.ad_errors for select to authenticated using (public.is_admin());

create or replace function public.log_ad_error(p_placement text, p_code int, p_message text, p_build int default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare u uuid := auth.uid();
begin
  if u is null then return; end if;
  if (select count(*) from ad_errors where user_id = u and created_at > now() - interval '1 hour') >= 20 then return; end if;
  insert into ad_errors (user_id, placement, code, message, app_build) values (u, left(p_placement, 40), p_code, left(p_message, 300), p_build);
  delete from ad_errors where created_at < now() - interval '14 days';
end $function$;
revoke execute on function public.log_ad_error(text, int, text, int) from public, anon;
grant execute on function public.log_ad_error(text, int, text, int) to authenticated;
