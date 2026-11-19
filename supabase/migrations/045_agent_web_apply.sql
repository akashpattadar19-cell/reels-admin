-- 045: এজেন্ট আবেদন শুধু ওয়েবসাইট থেকে (অ্যাপে আবেদনের অপশন নেই)।
-- ইউজার ওয়েবসাইটে নাম, ফোন, Reels Enjoy ID, এলাকা, পরিকল্পনা দেয় → agent_applications → অ্যাডমিন ID দেখে যাচাই করে অনুমোদন দিলে
-- profiles.agent_status = 'approved' → তখন অ্যাপে এজেন্ট পেজ (আয়ের নিয়ম, লিংক, অগ্রগতি) দেখায়।
create table if not exists agent_applications (
  id bigserial primary key,
  user_id uuid references profiles(id) on delete set null,
  user_no bigint not null,
  name text not null,
  phone text not null,
  area text,
  plan text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists agent_applications_status on agent_applications (status, created_at desc);
alter table agent_applications enable row level security;
revoke all on agent_applications from anon, authenticated;

-- ওয়েবসাইট (লগইন ছাড়া) থেকে আবেদন
create or replace function public.agent_web_apply(p_user_no bigint, p_name text, p_phone text, p_area text default null, p_plan text default null)
returns text language plpgsql security definer set search_path = public as $$
declare u record; ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
begin
  if public.setting_text('agent_enabled') <> 'true' then raise exception 'AGENT_OFF'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'NAME'; end if;
  if length(ph) < 8 or length(ph) > 16 then raise exception 'PHONE'; end if;
  select id, status, agent_status into u from profiles where user_no = p_user_no;
  if not found then raise exception 'NO_SUCH_ID'; end if;
  if u.status <> 'active' then raise exception 'ACCOUNT_BLOCKED'; end if;
  if u.agent_status = 'approved' then return 'already_agent'; end if;
  if exists (select 1 from agent_applications where user_no = p_user_no and status = 'pending') then return 'already_pending'; end if;
  -- স্প্যাম ঠেকাতে: এক ঘণ্টায় সব মিলিয়ে সর্বোচ্চ ৩০টি আবেদন, একই ফোনে দিনে ৩টি
  if (select count(*) from agent_applications where created_at > now() - interval '1 hour') >= 30 then raise exception 'TRY_LATER'; end if;
  if (select count(*) from agent_applications where phone = ph and created_at > now() - interval '1 day') >= 3 then raise exception 'TRY_LATER'; end if;
  insert into agent_applications (user_id, user_no, name, phone, area, plan)
  values (u.id, p_user_no, left(trim(p_name), 80), ph, left(nullif(trim(p_area), ''), 120), left(nullif(trim(p_plan), ''), 500));
  update profiles set agent_status = 'pending', agent_applied_at = now() where id = u.id and agent_status is distinct from 'approved';
  return 'ok';
end $$;

create or replace function public.admin_agent_applications(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select a.id, a.user_no, a.name, a.phone, a.area, a.plan, a.status, a.admin_note, a.created_at, a.reviewed_at,
           p.id user_id, p.username, p.full_name, p.avatar_url, p.country_code, p.followers_count, p.videos_count, p.created_at joined_at,
           p.status account_status, p.agent_status,
           (select count(*) from profiles r where r.referred_by = p.id) referred,
           (select count(*) from profiles r where r.referred_by = p.id and r.referral_qualified_at is not null) referred_ok,
           exists (select 1 from user_devices d1 join user_devices d2 on d2.device_hash = d1.device_hash and d2.user_id <> d1.user_id where d1.user_id = p.id) shared_device,
           exists (select 1 from user_devices d where d.user_id = p.id) has_device
      from agent_applications a left join profiles p on p.id = a.user_id
     where p_status = 'all' or a.status = p_status
     order by a.created_at desc limit 200) x), '[]');
end $$;

create or replace function public.admin_agent_application_action(p_id bigint, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a agent_applications;
begin
  perform public._require_admin();
  select * into a from agent_applications where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action = 'approve' then
    update agent_applications set status = 'approved', reviewed_at = now(), admin_note = nullif(trim(p_note), '') where id = p_id;
    perform public.admin_agent_action(a.user_id, 'approve', p_note);
  elsif p_action = 'reject' then
    update agent_applications set status = 'rejected', reviewed_at = now(), admin_note = nullif(trim(p_note), '') where id = p_id;
    if exists (select 1 from profiles where id = a.user_id and agent_status = 'pending') then
      perform public.admin_agent_action(a.user_id, 'reject', p_note);
    end if;
  else
    raise exception 'BAD_ACTION';
  end if;
end $$;

revoke all on function public.agent_web_apply(bigint, text, text, text, text) from public;
grant execute on function public.agent_web_apply(bigint, text, text, text, text) to anon, authenticated;
revoke all on function public.admin_agent_applications(text), public.admin_agent_application_action(bigint, text, text) from public, anon;
grant execute on function public.admin_agent_applications(text), public.admin_agent_application_action(bigint, text, text) to authenticated;
-- অ্যাপের ভেতরের আবেদন বন্ধ
revoke execute on function public.agent_apply(text) from authenticated;
