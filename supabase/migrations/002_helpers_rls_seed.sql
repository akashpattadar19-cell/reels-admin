-- ========== HELPERS ==========
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create or replace function public.setting_int(k text) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::bigint from settings where key = k), 0);
$$;

create or replace function public.setting_text(k text) returns text
language sql stable security definer set search_path = public as $$
  select (select value #>> '{}' from settings where key = k);
$$;

create or replace function public.today_bd() returns date
language sql stable as $$ select (now() at time zone 'Asia/Dhaka')::date; $$;

create or replace function public._active_user() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  if exists (select 1 from profiles where id = u and status = 'banned') then
    raise exception 'ACCOUNT_BANNED';
  end if;
  return u;
end $$;

create or replace function public._require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return auth.uid();
end $$;

-- একমাত্র জায়গা যেখানে ব্যালেন্স বদলায়: ওয়ালেট আপডেট + লেজার এন্ট্রি
create or replace function public._wallet_move(
  p_user uuid, p_bucket text, p_amount bigint, p_type text,
  p_ref_type text default null, p_ref_id bigint default null, p_note text default null,
  p_idem text default null, p_available_at timestamptz default null, p_by uuid default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_after bigint; v_earned bigint := 0;
begin
  if p_amount = 0 then return null; end if;
  if p_idem is not null and exists (select 1 from transactions where idem_key = p_idem) then
    return null;
  end if;
  insert into wallets (user_id) values (p_user) on conflict do nothing;
  if p_amount > 0 and p_type in ('view_earning','like_earning','comment_earning','gift_received','points_convert') then
    v_earned := p_amount;
  end if;

  if p_bucket = 'coin' then
    update wallets set coin_balance = coin_balance + p_amount, updated_at = now()
      where user_id = p_user returning coin_balance into v_after;
  elsif p_bucket = 'earning' then
    update wallets set earning_paisa = earning_paisa + p_amount,
           total_earned_paisa = total_earned_paisa + v_earned, updated_at = now()
      where user_id = p_user returning earning_paisa into v_after;
  elsif p_bucket = 'pending' then
    update wallets set pending_paisa = pending_paisa + p_amount,
           total_earned_paisa = total_earned_paisa + v_earned, updated_at = now()
      where user_id = p_user returning pending_paisa into v_after;
  elsif p_bucket = 'points' then
    update wallets set points = points + p_amount, updated_at = now()
      where user_id = p_user returning points into v_after;
  else
    raise exception 'BAD_BUCKET';
  end if;

  insert into transactions (user_id, type, bucket, amount, balance_after, ref_type, ref_id,
                            note, idem_key, available_at, created_by)
  values (p_user, p_type, p_bucket, p_amount, v_after, p_ref_type, p_ref_id,
          p_note, p_idem, p_available_at, p_by);
  return v_after;
end $$;

create or replace function public._notify(p_user uuid, p_type text, p_title text, p_body text, p_data jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, title, body, data) values (p_user, p_type, p_title, p_body, p_data);
$$;

create or replace function public._audit(p_action text, p_target_type text, p_target_id text, p_reason text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (admin_id, action, target_type, target_id, reason, meta)
  values (auth.uid(), p_action, p_target_type, p_target_id, p_reason, p_meta);
$$;

revoke execute on function public._wallet_move, public._notify, public._audit from public, anon, authenticated;

-- ========== NEW USER ==========
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}');
        v_username text;
begin
  v_username := lower(coalesce(nullif(m->>'username',''), 'user' || substr(replace(new.id::text,'-',''),1,8)));
  insert into profiles (id, username, full_name) values (new.id, v_username, m->>'full_name');
  if m ? 'phone' then
    insert into user_private (user_id, phone) values (new.id, m->>'phone');
  end if;
  insert into wallets (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ফলো কাউন্টার
create or replace function public.follow_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update profiles set following_count = following_count + 1 where id = new.follower_id;
    update profiles set followers_count = followers_count + 1 where id = new.following_id;
  else
    update profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    update profiles set followers_count = greatest(followers_count - 1, 0) where id = old.following_id;
  end if;
  return null;
end $$;
create trigger trg_follow_counts after insert or delete on public.follows
  for each row execute function public.follow_counts();

-- ========== RLS ==========
alter table public.profiles            enable row level security;
alter table public.user_private        enable row level security;
alter table public.follows             enable row level security;
alter table public.videos              enable row level security;
alter table public.hashtags            enable row level security;
alter table public.video_hashtags      enable row level security;
alter table public.video_views         enable row level security;
alter table public.likes               enable row level security;
alter table public.like_rewards        enable row level security;
alter table public.comments            enable row level security;
alter table public.comment_rewards     enable row level security;
alter table public.shares              enable row level security;
alter table public.gift_categories     enable row level security;
alter table public.gifts               enable row level security;
alter table public.gift_transactions   enable row level security;
alter table public.wallets             enable row level security;
alter table public.transactions        enable row level security;
alter table public.cash_in_requests    enable row level security;
alter table public.withdraw_requests   enable row level security;
alter table public.ad_placements       enable row level security;
alter table public.ad_rewards          enable row level security;
alter table public.notifications       enable row level security;
alter table public.content_reports     enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.settings            enable row level security;
alter table public.creator_daily_stats enable row level security;
alter table public.viewer_daily_points enable row level security;

-- সবাই দেখতে পারে
create policy "read all" on public.profiles        for select using (true);
create policy "read all" on public.follows         for select using (true);
create policy "read all" on public.hashtags        for select using (true);
create policy "read all" on public.video_hashtags  for select using (true);
create policy "read all" on public.gift_categories for select using (true);
create policy "read all" on public.gifts           for select using (true);
create policy "read all" on public.ad_placements   for select using (true);

create policy "read" on public.videos for select
  using (status = 'published' or user_id = auth.uid() or public.is_admin());
create policy "read" on public.comments for select
  using (status = 'visible' or public.is_admin());
create policy "read" on public.settings for select
  using (is_public or public.is_admin());

-- নিজের বা অ্যাডমিন
create policy "own" on public.user_private        for select using (user_id = auth.uid() or public.is_admin());
create policy "own" on public.likes               for select using (user_id = auth.uid() or public.is_admin());
create policy "own" on public.wallets             for select using (user_id = auth.uid() or public.is_admin());
create policy "own" on public.transactions        for select using (user_id = auth.uid() or public.is_admin());
create policy "own" on public.cash_in_requests    for select using (user_id = auth.uid() or public.is_admin());
create policy "own" on public.withdraw_requests   for select using (user_id = auth.uid() or public.is_admin());
create policy "own" on public.notifications       for select using (user_id = auth.uid());
create policy "own" on public.creator_daily_stats for select using (user_id = auth.uid() or public.is_admin());
create policy "own" on public.viewer_daily_points for select using (user_id = auth.uid() or public.is_admin());
create policy "own" on public.gift_transactions   for select
  using (sender_id = auth.uid() or receiver_id = auth.uid() or public.is_admin());

-- শুধু অ্যাডমিন
create policy "admin" on public.video_views     for select using (public.is_admin());
create policy "admin" on public.shares          for select using (public.is_admin());
create policy "admin" on public.ad_rewards      for select using (public.is_admin());
create policy "admin" on public.content_reports for select using (public.is_admin());
create policy "admin" on public.audit_logs      for select using (public.is_admin());

-- অ্যাডমিন সরাসরি এডিট করতে পারে (টাকার টেবিল নয়)
create policy "admin write" on public.gift_categories for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.gifts           for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.ad_placements   for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.settings        for update using (public.is_admin()) with check (public.is_admin());

-- Realtime: নোটিফিকেশন ও ওয়ালেট
alter publication supabase_realtime add table public.notifications, public.wallets;

-- ========== STORAGE ==========
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('videos',  'videos',  true, 52428800, array['video/mp4','video/quicktime','video/webm']),
  ('thumbs',  'thumbs',  true, 2097152,  array['image/jpeg','image/png','image/webp']),
  ('avatars', 'avatars', true, 2097152,  array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- প্রতিটি ইউজার শুধু নিজের ফোল্ডারে (<user_id>/...) আপলোড/ডিলিট করতে পারবে
create policy "upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id in ('videos','thumbs','avatars')
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "update own folder" on storage.objects for update to authenticated
  using (bucket_id in ('videos','thumbs','avatars') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own or admin" on storage.objects for delete to authenticated
  using (bucket_id in ('videos','thumbs','avatars')
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ========== SEED ==========
insert into public.settings (key, value, description, is_public) values
  ('coin_price_paisa',            '100',    '১ কয়েনের দাম (পয়সা)', true),
  ('point_value_paisa',           '1',      '১ পয়েন্ট = কত পয়সা', true),
  ('points_convert_min',          '1000',   'সর্বনিম্ন পয়েন্ট কনভার্ট', true),
  ('view_rate_paisa_per_1000',    '500',    'ক্রিয়েটর: প্রতি ১০০০ ভিউ (পয়সা)', true),
  ('like_rate_paisa',             '1',      'ক্রিয়েটর: প্রতি লাইক (পয়সা)', true),
  ('comment_rate_paisa',          '2',      'ক্রিয়েটর: প্রতি ইউনিক কমেন্ট (পয়সা)', true),
  ('min_watch_ms',                '5000',   'ভ্যালিড ভিউর সর্বনিম্ন দেখা (মিলিসেকেন্ড)', true),
  ('watch_points',                '1',      'দর্শক: প্রতি ভ্যালিড ভিউ পয়েন্ট', true),
  ('viewer_daily_points_cap',     '200',    'দর্শক: দৈনিক পয়েন্ট সীমা (ভিউ থেকে)', true),
  ('creator_daily_view_cap_paisa','100000', 'ক্রিয়েটর: দৈনিক ভিউ-ইনকাম সীমা (পয়সা)', true),
  ('pending_hold_hours',          '48',     'ইনকাম pending থেকে available হতে ঘণ্টা', true),
  ('withdraw_min_paisa',          '50000',  'সর্বনিম্ন উইথড্র (পয়সা)', true),
  ('withdraw_cooldown_days',      '7',      'দুই উইথড্রর মাঝে দিন', true),
  ('withdraw_fee_pct',            '0',      'উইথড্র চার্জ %', true),
  ('min_account_age_days',        '3',      'উইথড্রর জন্য অ্যাকাউন্টের বয়স (দিন)', true),
  ('min_cash_in_taka',            '20',     'সর্বনিম্ন ক্যাশ-ইন (টাকা)', true),
  ('max_video_sec',               '90',     'সর্বোচ্চ ভিডিও দৈর্ঘ্য (সেকেন্ড)', true),
  ('bkash_number',                '""',     'ক্যাশ-ইনের bKash নম্বর', true),
  ('nagad_number',                '""',     'ক্যাশ-ইনের Nagad নম্বর', true),
  ('rocket_number',               '""',     'ক্যাশ-ইনের Rocket নম্বর', true),
  ('app_notice',                  '""',     'অ্যাপের উপরে নোটিশ', true),
  ('earnings_enabled',            'true',   'ইনকাম চালু/বন্ধ', true);

insert into public.gift_categories (id, name, sort_order) values (1, 'জনপ্রিয়', 1), (2, 'প্রিমিয়াম', 2);
select setval('public.gift_categories_id_seq', 2);
insert into public.gifts (category_id, name, icon, coin_price, sort_order) values
  (1, 'হার্ট',    '❤️', 5,    1),
  (1, 'গোলাপ',   '🌹', 10,   2),
  (1, 'চকলেট',   '🍫', 20,   3),
  (1, 'আইসক্রিম', '🍦', 30,   4),
  (1, 'তারকা',   '⭐', 50,   5),
  (2, 'মুকুট',    '👑', 200,  6),
  (2, 'রকেট',    '🚀', 500,  7),
  (2, 'গাড়ি',    '🏎️', 1000, 8);

-- Google-এর টেস্ট অ্যাড ইউনিট; আসল AdMob আইডি অ্যাডমিন প্যানেল থেকে বসাতে হবে
insert into public.ad_placements (key, ad_type, unit_id_android, every_n_videos, viewer_points, creator_points, daily_cap, is_active) values
  ('feed_interstitial', 'interstitial', 'ca-app-pub-3940256099942544/1033173712', 6,    0,  0,  null, true),
  ('rewarded_points',   'rewarded',     'ca-app-pub-3940256099942544/5224354917', null, 20, 10, 10,   true),
  ('profile_banner',    'banner',       'ca-app-pub-3940256099942544/6300978111', null, 0,  0,  null, true);
