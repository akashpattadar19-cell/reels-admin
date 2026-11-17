-- ১) প্রত্যেক ইউজারের নিজস্ব ID নম্বর (100001 থেকে শুরু)
create sequence if not exists public.user_no_seq start 100001;
alter table public.profiles add column if not exists user_no bigint unique default nextval('public.user_no_seq');
alter table public.profiles alter column user_no set not null;

-- ২) ভিডিও পেন্ডিং → ২ মিনিট পরে অটো অ্যাপ্রুভ
alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in ('pending','published','rejected','deleted'));
alter table public.videos alter column status set default 'pending';
alter table public.videos add column if not exists approved_at timestamptz;
insert into public.settings (key, value, description, is_public) values
  ('auto_approve_minutes', '2', 'ভিডিও কত মিনিট পর নিজে থেকে অ্যাপ্রুভ হবে (0 = শুধু অ্যাডমিন অ্যাপ্রুভ করবে)', true),
  ('vault_quota_mb', '100', 'প্রতি ইউজারের লক ফোল্ডারের জায়গা (MB)', true)
on conflict (key) do nothing;

create or replace function public.create_video(p_video_path text, p_video_url text, p_thumb_url text,
                                               p_caption text, p_duration int)
returns bigint language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); v_id bigint; t text; h_id bigint; adm boolean := public.is_admin();
begin
  if p_video_path is null or split_part(p_video_path, '/', 1) <> u::text then raise exception 'BAD_PATH'; end if;
  if p_video_url not like '%/storage/v1/object/public/videos/' || p_video_path then raise exception 'BAD_URL'; end if;
  if p_thumb_url is not null and p_thumb_url not like '%/storage/v1/object/public/thumbs/' || u::text || '/%' then
    raise exception 'BAD_THUMB';
  end if;
  if p_duration is not null and p_duration > public.setting_int('max_video_sec') + 2 then raise exception 'VIDEO_TOO_LONG'; end if;
  if not adm and (select count(*) from videos where user_id = u and created_at > now() - interval '1 day') >= 20 then
    raise exception 'UPLOAD_LIMIT';
  end if;
  insert into videos (user_id, caption, video_path, video_url, thumb_url, duration_sec, uploaded_by_admin, status, approved_at)
  values (u, nullif(trim(p_caption), ''), p_video_path, p_video_url, p_thumb_url, p_duration, adm,
          case when adm then 'published' else 'pending' end, case when adm then now() end)
  returning id into v_id;
  update profiles set videos_count = videos_count + 1 where id = u;
  for t in select distinct lower(m[1]) from regexp_matches(coalesce(p_caption, ''), '#([^\s#]{1,60})', 'g') as m loop
    insert into hashtags (tag, use_count) values (t, 1)
      on conflict (tag) do update set use_count = hashtags.use_count + 1 returning id into h_id;
    insert into video_hashtags values (v_id, h_id) on conflict do nothing;
  end loop;
  return v_id;
end $$;

create or replace function public.auto_approve_videos() returns int
language plpgsql security definer set search_path = public as $$
declare m int := public.setting_int('auto_approve_minutes')::int; n int;
begin
  if m <= 0 then return 0; end if;
  update videos set status = 'published', approved_at = now()
   where status = 'pending' and created_at <= now() - make_interval(mins => m);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.auto_approve_videos() from public, anon, authenticated;
select cron.schedule('auto-approve-videos', '* * * * *', 'select public.auto_approve_videos()');

create or replace function public.admin_video_action(p_id bigint, p_action text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public._require_admin();
  select * into v from videos where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action = 'approve' then
    update videos set status = 'published', approved_at = now(), reject_reason = null where id = p_id;
    if v.status in ('rejected','deleted') then update profiles set videos_count = videos_count + 1 where id = v.user_id; end if;
    perform public._notify(v.user_id, 'system', 'আপনার ভিডিও প্রকাশিত হয়েছে ✅', null, json_build_object('video_id', p_id)::jsonb);
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
  perform public._audit('video_' || p_action, 'video', p_id::text, p_reason);
end $$;

-- ৩) অ্যাডমিন কয়েন পাঠানো (Coin Sent)
create or replace function public.admin_send_coins(p_user_no bigint, p_coins bigint, p_note text) returns json
language plpgsql security definer set search_path = public as $$
declare a uuid := public._require_admin(); target record; bal bigint;
begin
  if p_coins is null or p_coins < 1 or p_coins > 100000000 then raise exception 'BAD_AMOUNT'; end if;
  select id, username, full_name into target from profiles where user_no = p_user_no;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  perform 1 from wallets where user_id = target.id for update;
  bal := public._wallet_move(target.id, 'coin', p_coins, 'admin_coin_grant', 'admin', null,
                             coalesce(nullif(trim(p_note), ''), 'অ্যাডমিন থেকে কয়েন'), null, null, a);
  perform public._audit('send_coins', 'user', target.id::text, p_note, json_build_object('coins', p_coins, 'user_no', p_user_no)::jsonb);
  perform public._notify(target.id, 'cash_in', 'আপনি 🪙 ' || p_coins || ' কয়েন পেয়েছেন', nullif(trim(p_note), ''), '{}'::jsonb);
  return json_build_object('ok', true, 'username', target.username, 'full_name', target.full_name, 'coin_balance', bal);
end $$;
revoke execute on function public.admin_send_coins(bigint, bigint, text) from public, anon;

-- ৪) লক ফোল্ডার (প্রাইভেট; শুধু নিজে ও অ্যাডমিন দেখতে পারে)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('vault', 'vault', false, 52428800, array['image/jpeg','image/png','image/webp','image/gif','image/heic','video/mp4','video/quicktime','video/webm','video/3gpp'])
on conflict (id) do nothing;

create table if not exists public.vault_files (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  path       text unique not null,
  kind       text not null check (kind in ('image','video')),
  mime       text,
  name       text,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);
create index if not exists vault_files_user_idx on public.vault_files (user_id, id desc);
alter table public.vault_files enable row level security;
create policy "own or admin" on public.vault_files for select using (user_id = auth.uid() or public.is_admin());

create or replace function public.vault_used(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(size_bytes), 0)::bigint from vault_files where user_id = p_user;
$$;
create or replace function public.vault_quota_bytes() returns bigint
language sql stable security definer set search_path = public as $$
  select public.setting_int('vault_quota_mb') * 1048576;
$$;
revoke execute on function public.vault_used(uuid), public.vault_quota_bytes() from public, anon;
grant execute on function public.vault_used(uuid), public.vault_quota_bytes() to authenticated;

create policy "vault upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text
              and public.vault_used(auth.uid()) < public.vault_quota_bytes());
create policy "vault read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'vault' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "vault delete own or admin" on storage.objects for delete to authenticated
  using (bucket_id = 'vault' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create or replace function public.vault_add(p_path text, p_size bigint, p_mime text, p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); used bigint; quota bigint := public.vault_quota_bytes(); r_id bigint;
begin
  if split_part(p_path, '/', 1) <> u::text then raise exception 'BAD_PATH'; end if;
  used := public.vault_used(u);
  if used + p_size > quota then raise exception 'VAULT_FULL'; end if;
  insert into vault_files (user_id, path, kind, mime, name, size_bytes)
  values (u, p_path, case when p_mime like 'video/%' then 'video' else 'image' end, p_mime, left(p_name, 120), p_size)
  returning id into r_id;
  return json_build_object('id', r_id, 'used', used + p_size, 'quota', quota);
end $$;

create or replace function public.vault_remove(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); p text;
begin
  delete from vault_files where id = p_id and (user_id = u or public.is_admin()) returning path into p;
  if p is null then raise exception 'NOT_FOUND'; end if;
  return p;
end $$;
revoke execute on function public.vault_add(text, bigint, text, text), public.vault_remove(bigint) from public, anon;
