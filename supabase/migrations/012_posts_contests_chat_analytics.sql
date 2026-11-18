-- 012: Photo & text posts (Text Earning), photo contests, direct messages, cover photo,
--      app-time tracking + admin analytics, admin-approved premium access for hosts.

alter table profiles
  add column if not exists cover_url text,
  add column if not exists premium_access boolean not null default false;

-- ---------- posts (photo / text) ----------
create table if not exists contests (
  id bigserial primary key,
  title text not null check (char_length(title) between 2 and 120),
  description text,
  prize_paisa bigint not null default 0 check (prize_paisa >= 0),
  cover_url text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  is_active boolean not null default true,
  winner_post_id bigint,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists posts (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('photo','text')),
  body text check (char_length(body) <= 2000),
  image_path text,
  image_url text,
  category text,
  bg text,
  contest_id bigint references contests(id) on delete set null,
  status text not null default 'published' check (status in ('pending','published','rejected','deleted')),
  reject_reason text,
  likes_count int not null default 0,
  comments_count int not null default 0,
  shares_count int not null default 0,
  gifts_coins_total bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists posts_feed_idx on posts (kind, status, id desc);
create index if not exists posts_user_idx on posts (user_id, id desc);
create index if not exists posts_contest_idx on posts (contest_id, likes_count desc) where contest_id is not null;
alter table contests drop constraint if exists contests_winner_fk;
alter table contests add constraint contests_winner_fk foreign key (winner_post_id) references posts(id) on delete set null;

create table if not exists post_likes (post_id bigint references posts(id) on delete cascade, user_id uuid references profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (post_id, user_id));
create table if not exists post_like_rewards (post_id bigint, user_id uuid, primary key (post_id, user_id));
create table if not exists post_comments (id bigserial primary key, post_id bigint not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade, body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now());
create index if not exists post_comments_idx on post_comments (post_id, id);
create table if not exists post_comment_rewards (post_id bigint, user_id uuid, primary key (post_id, user_id));
create table if not exists post_shares (post_id bigint references posts(id) on delete cascade, user_id uuid references profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (post_id, user_id));

alter table gift_transactions add column if not exists post_id bigint references posts(id) on delete set null;

-- ---------- direct messages ----------
create table if not exists messages (
  id bigserial primary key,
  sender_id uuid not null references profiles(id) on delete cascade,
  receiver_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_pair_idx on messages (least(sender_id, receiver_id), greatest(sender_id, receiver_id), id desc);
create index if not exists messages_unread_idx on messages (receiver_id) where read_at is null;

-- ---------- app usage ----------
create table if not exists app_usage (
  user_id uuid not null references profiles(id) on delete cascade,
  day date not null,
  seconds int not null default 0,
  primary key (user_id, day)
);

-- RLS (clients only read)
alter table contests enable row level security;
alter table posts enable row level security;
alter table post_likes enable row level security;
alter table post_like_rewards enable row level security;
alter table post_comments enable row level security;
alter table post_comment_rewards enable row level security;
alter table post_shares enable row level security;
alter table messages enable row level security;
alter table app_usage enable row level security;
drop policy if exists c_read on contests;       create policy c_read on contests for select to authenticated using (true);
drop policy if exists p_read on posts;          create policy p_read on posts for select to authenticated using (status = 'published' or user_id = auth.uid() or public.is_admin());
drop policy if exists pl_read on post_likes;    create policy pl_read on post_likes for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists pc_read on post_comments; create policy pc_read on post_comments for select to authenticated using (true);
drop policy if exists m_read on messages;       create policy m_read on messages for select to authenticated using (sender_id = auth.uid() or receiver_id = auth.uid());
drop policy if exists au_read on app_usage;     create policy au_read on app_usage for select to authenticated using (user_id = auth.uid() or public.is_admin());

do $$ begin
  begin alter publication supabase_realtime add table messages; exception when duplicate_object then null; end;
end $$;

-- photos bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "photos upload own" on storage.objects;
create policy "photos upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos delete own or admin" on storage.objects;
create policy "photos delete own or admin" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

insert into settings (key, value, description, is_public) values
  ('post_like_rate_paisa',      '1',     'ফটো/টেক্সট: প্রতি লাইকে (পয়সা)', true),
  ('post_comment_rate_paisa',   '2',     'ফটো/টেক্সট: প্রতি কমেন্টকারীতে (পয়সা)', true),
  ('post_share_rate_paisa',     '1',     'ফটো/টেক্সট: প্রতি শেয়ারে (পয়সা)', true),
  ('post_daily_cap_paisa',      '20000', 'ফটো/টেক্সট থেকে দিনে সর্বোচ্চ আয় (পয়সা)', true),
  ('post_daily_limit',          '20',    'দিনে কয়টি ফটো/টেক্সট পোস্ট', true),
  ('post_auto_approve',         'true',  'ফটো/টেক্সট সাথে সাথে প্রকাশ', true),
  ('text_max_lines',            '6',     'টেক্সট পোস্টে সর্বোচ্চ লাইন', true),
  ('text_max_chars',            '600',   'টেক্সট পোস্টে সর্বোচ্চ অক্ষর', true),
  ('dm_enabled',                'true',  'ইউজাররা একে অপরকে মেসেজ দিতে পারবে', true),
  ('premium_upload_hosts_only', 'true',  'শুধু হোস্টরা প্রিমিয়াম ভিডিও দিতে পারবে', true),
  ('premium_notice', to_jsonb('প্রিমিয়ামে বাংলা, ইংরেজি বা হিন্দি মুভি, ওয়েব সিরিজ, নাটক বা ভিডিও দিতে পারবেন — তবে শুধু আপনার নিজের বানানো অথবা যার অনুমতি/লাইসেন্স আপনার আছে। অনুমতি ছাড়া অন্যের মুভি বা সিরিজ দিলে কপিরাইট অভিযোগে ভিডিও মুছে যাবে। অশ্লীল, নগ্ন বা যৌন কোনো ভিডিও ১০০% নিষিদ্ধ — দিলে ইনকাম বাতিল হবে এবং অ্যাকাউন্ট জেলে বা ব্লক হতে পারে।'::text),
                                       'প্রিমিয়াম আপলোডের নোটিশ', true),
  ('text_notice', to_jsonb('নিজের লেখা শায়েরি, গল্প, কবিতা, মজার কথা বা রোমান্টিক লেখা দিন। অন্যের লেখা কপি, গালাগালি বা অশ্লীল লেখা দিলে পোস্ট মুছে যাবে এবং অ্যাকাউন্ট জেলে যেতে পারে।'::text),
                                       'টেক্সট পোস্টের নোটিশ', true)
on conflict (key) do nothing;

-- ledger: new earning types count as "earned"
create or replace function public._wallet_move(p_user uuid, p_bucket text, p_amount bigint, p_type text, p_ref_type text default null,
  p_ref_id bigint default null, p_note text default null, p_idem text default null, p_available_at timestamptz default null, p_by uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_after bigint; v_earned bigint := 0;
begin
  if p_amount = 0 then return null; end if;
  if p_idem is not null and exists (select 1 from transactions where idem_key = p_idem) then return null; end if;
  insert into wallets (user_id) values (p_user) on conflict do nothing;
  if p_amount > 0 and p_type in ('view_earning','like_earning','comment_earning','gift_received','points_convert',
                                 'referral_bonus','referral_tier_bonus','post_like_earning','post_comment_earning',
                                 'post_share_earning','contest_prize') then
    v_earned := p_amount;
  end if;
  if p_bucket = 'coin' then
    update wallets set coin_balance = coin_balance + p_amount, updated_at = now() where user_id = p_user returning coin_balance into v_after;
  elsif p_bucket = 'earning' then
    update wallets set earning_paisa = earning_paisa + p_amount, total_earned_paisa = total_earned_paisa + v_earned, updated_at = now()
      where user_id = p_user returning earning_paisa into v_after;
  elsif p_bucket = 'pending' then
    update wallets set pending_paisa = pending_paisa + p_amount, total_earned_paisa = total_earned_paisa + v_earned, updated_at = now()
      where user_id = p_user returning pending_paisa into v_after;
  elsif p_bucket = 'points' then
    update wallets set points = points + p_amount, updated_at = now() where user_id = p_user returning points into v_after;
  else
    raise exception 'BAD_BUCKET';
  end if;
  insert into transactions (user_id, type, bucket, amount, balance_after, ref_type, ref_id, note, idem_key, available_at, created_by)
  values (p_user, p_type, p_bucket, p_amount, v_after, p_ref_type, p_ref_id, p_note, p_idem, p_available_at, p_by);
  return v_after;
end $$;

-- creator earning from posts, with a daily cap
create or replace function public._post_earn(p_owner uuid, p_rate_key text, p_type text, p_post bigint, p_idem text)
returns void language plpgsql security definer set search_path = public as $$
declare amt bigint := public.setting_int(p_rate_key); cap bigint := public.setting_int('post_daily_cap_paisa'); got bigint;
begin
  if amt <= 0 or coalesce(public.setting_text('earnings_enabled'), 'true') <> 'true' then return; end if;
  select coalesce(sum(amount), 0) into got from transactions
   where user_id = p_owner and type in ('post_like_earning','post_comment_earning','post_share_earning')
     and created_at >= (public.today_bd()::timestamp at time zone 'Asia/Dhaka');
  if cap > 0 then amt := least(amt, cap - got); end if;
  if amt <= 0 then return; end if;
  perform public._wallet_move(p_owner, 'pending', amt, p_type, 'post', p_post, null, p_idem,
                              now() + make_interval(hours => public.setting_int('pending_hold_hours')::int));
end $$;

create or replace function public.create_post(p_kind text, p_body text, p_image_path text, p_image_url text,
                                              p_category text, p_bg text, p_contest bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); adm boolean := public.is_admin(); c record; id_ bigint; body text := nullif(trim(p_body), '');
begin
  if p_kind not in ('photo','text') then raise exception 'BAD_KIND'; end if;
  if not adm and (select count(*) from posts where user_id = u and created_at > now() - interval '1 day') >= public.setting_int('post_daily_limit') then
    raise exception 'UPLOAD_LIMIT';
  end if;
  if p_kind = 'photo' then
    if p_image_path is null or split_part(p_image_path, '/', 1) <> u::text
       or p_image_url not like '%/storage/v1/object/public/photos/' || p_image_path then raise exception 'BAD_URL'; end if;
    if char_length(coalesce(body, '')) > 500 then raise exception 'TEXT_TOO_LONG'; end if;
  else
    if body is null then raise exception 'EMPTY_TEXT'; end if;
    if char_length(body) > public.setting_int('text_max_chars') then raise exception 'TEXT_TOO_LONG'; end if;
    if array_length(regexp_split_to_array(body, E'\n'), 1) > public.setting_int('text_max_lines') then raise exception 'TOO_MANY_LINES'; end if;
    p_contest := null;
  end if;
  if p_contest is not null then
    select * into c from contests where id = p_contest;
    if not found or not c.is_active or c.finished_at is not null or now() < c.starts_at or now() > c.ends_at then raise exception 'CONTEST_CLOSED'; end if;
    if exists (select 1 from posts where contest_id = p_contest and user_id = u and status in ('pending','published')) then raise exception 'ALREADY_JOINED'; end if;
  end if;
  insert into posts (user_id, kind, body, image_path, image_url, category, bg, contest_id, status)
  values (u, p_kind, body, case when p_kind = 'photo' then p_image_path end, case when p_kind = 'photo' then p_image_url end,
          left(p_category, 20), left(p_bg, 20), p_contest,
          case when adm or coalesce(public.setting_text('post_auto_approve'), 'true') = 'true' then 'published' else 'pending' end)
  returning id into id_;
  return id_;
end $$;

create or replace function public.feed_posts(p_kind text, p_before bigint default null, p_limit int default 20, p_category text default null,
                                             p_contest bigint default null, p_user uuid default null, p_sort text default 'new')
returns table(id bigint, user_id uuid, username text, full_name text, avatar_url text, country_code text, level int,
              kind text, body text, image_url text, category text, bg text, contest_id bigint,
              likes_count int, comments_count int, shares_count int, gifts_coins_total bigint, created_at timestamptz,
              liked_by_me boolean, status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.user_id, pr.username, pr.full_name, pr.avatar_url, pr.country_code, public._level(pr.followers_count),
         p.kind, p.body, p.image_url, p.category, p.bg, p.contest_id,
         p.likes_count, p.comments_count, p.shares_count, p.gifts_coins_total, p.created_at,
         exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid()), p.status
  from posts p join profiles pr on pr.id = p.user_id
  where (p.status = 'published' or (p_user is not null and p.user_id = auth.uid() and p.status = 'pending'))
    and pr.status = 'active'
    and (p_kind is null or p.kind = p_kind)
    and (p_category is null or p_category = '' or p.category = p_category)
    and (p_contest is null or p.contest_id = p_contest)
    and (p_user is null or p.user_id = p_user)
    and (p_sort = 'top' or p_before is null or p.id < p_before)
  order by case when p_sort = 'top' then p.likes_count end desc nulls last, p.id desc
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.toggle_post_like(p_post bigint) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); p record; n int; liked boolean; cnt int; uname text;
begin
  select id, user_id, status into p from posts where id = p_post;
  if not found or p.status <> 'published' then raise exception 'NOT_FOUND'; end if;
  delete from post_likes where user_id = u and post_id = p_post;
  get diagnostics n = row_count;
  if n > 0 then
    update posts set likes_count = greatest(likes_count - 1, 0) where id = p_post returning likes_count into cnt; liked := false;
  else
    insert into post_likes (post_id, user_id) values (p_post, u);
    update posts set likes_count = likes_count + 1 where id = p_post returning likes_count into cnt; liked := true;
    if p.user_id <> u then
      insert into post_like_rewards values (p_post, u) on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        perform public._post_earn(p.user_id, 'post_like_rate_paisa', 'post_like_earning', p_post, 'plike:' || u || ':' || p_post);
        select username into uname from profiles where id = u;
        perform public._notify(p.user_id, 'like', uname || ' আপনার পোস্ট লাইক করেছে', null, json_build_object('post_id', p_post)::jsonb);
      end if;
    end if;
  end if;
  return json_build_object('liked', liked, 'likes_count', cnt);
end $$;

create or replace function public.add_post_comment(p_post bigint, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); p record; cid bigint; n int; uname text;
begin
  select id, user_id, status into p from posts where id = p_post;
  if not found or p.status <> 'published' then raise exception 'NOT_FOUND'; end if;
  if nullif(trim(p_body), '') is null then raise exception 'EMPTY_TEXT'; end if;
  insert into post_comments (post_id, user_id, body) values (p_post, u, left(trim(p_body), 500)) returning id into cid;
  update posts set comments_count = comments_count + 1 where id = p_post;
  if p.user_id <> u then
    insert into post_comment_rewards values (p_post, u) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 then perform public._post_earn(p.user_id, 'post_comment_rate_paisa', 'post_comment_earning', p_post, 'pcmt:' || u || ':' || p_post); end if;
    select username into uname from profiles where id = u;
    perform public._notify(p.user_id, 'comment', uname || ' আপনার পোস্টে কমেন্ট করেছে', left(trim(p_body), 80), json_build_object('post_id', p_post)::jsonb);
  end if;
  return cid;
end $$;

create or replace function public.post_comments_list(p_post bigint) returns table(id bigint, user_id uuid, username text, avatar_url text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.user_id, pr.username, pr.avatar_url, c.body, c.created_at
  from post_comments c join profiles pr on pr.id = c.user_id where c.post_id = p_post order by c.id limit 300;
$$;

create or replace function public.delete_post_comment(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); rc record;
begin
  select c.id, c.post_id, c.user_id, p.user_id as owner into rc from post_comments c join posts p on p.id = c.post_id where c.id = p_id;
  if not found then return; end if;
  if rc.user_id <> u and rc.owner <> u and not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  delete from post_comments where id = p_id;
  update posts set comments_count = greatest(comments_count - 1, 0) where id = rc.post_id;
end $$;

create or replace function public.record_post_share(p_post bigint) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); p record; n int;
begin
  select id, user_id, status into p from posts where id = p_post;
  if not found or p.status <> 'published' then return; end if;
  insert into post_shares (post_id, user_id) values (p_post, u) on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    update posts set shares_count = shares_count + 1 where id = p_post;
    if p.user_id <> u then perform public._post_earn(p.user_id, 'post_share_rate_paisa', 'post_share_earning', p_post, 'pshare:' || u || ':' || p_post); end if;
  end if;
end $$;

create or replace function public.delete_post(p_post bigint) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  update posts set status = 'deleted' where id = p_post and (user_id = u or public.is_admin());
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create or replace function public.send_post_gift(p_post bigint, p_gift_id int, p_qty int, p_idem text) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); g record; p record; w record; gt record;
        qty int; total_coins bigint; total_paisa bigint; creator_part bigint; uname text;
begin
  if p_idem is null or length(p_idem) < 8 then raise exception 'BAD_IDEM'; end if;
  if exists (select 1 from gift_transactions where idem_key = p_idem) then
    return json_build_object('ok', true, 'duplicate', true, 'coin_balance', (select coin_balance from wallets where user_id = u));
  end if;
  select * into g from gifts where id = p_gift_id and is_active;
  if not found then raise exception 'GIFT_NOT_FOUND'; end if;
  select id, user_id, status into p from posts where id = p_post;
  if not found or p.status <> 'published' then raise exception 'NOT_FOUND'; end if;
  if p.user_id = u then raise exception 'SELF_GIFT'; end if;
  qty := least(greatest(coalesce(p_qty, 1), 1), 99);
  total_coins := g.coin_price::bigint * qty;
  total_paisa := total_coins * public.setting_int('coin_price_paisa');
  creator_part := floor(total_paisa * g.creator_share_pct / 100);
  perform 1 from wallets where user_id in (u, p.user_id) order by user_id for update;
  select * into w from wallets where user_id = u;
  if coalesce(w.coin_balance, 0) < total_coins then raise exception 'INSUFFICIENT_COINS'; end if;
  insert into gift_transactions (gift_id, sender_id, receiver_id, video_id, post_id, quantity, total_coins, creator_amount_paisa, platform_fee_paisa, idem_key)
  values (g.id, u, p.user_id, null, p_post, qty, total_coins, creator_part, total_paisa - creator_part, p_idem) returning * into gt;
  perform public._wallet_move(u, 'coin', -total_coins, 'gift_sent', 'gift_tx', gt.id, g.icon || ' ' || g.name || ' x' || qty, 'gift-s:' || p_idem);
  perform public._wallet_move(p.user_id, 'pending', creator_part, 'gift_received', 'gift_tx', gt.id, g.icon || ' ' || g.name || ' x' || qty, 'gift-r:' || p_idem,
                              now() + make_interval(hours => public.setting_int('pending_hold_hours')::int));
  update posts set gifts_coins_total = gifts_coins_total + total_coins where id = p_post;
  select username into uname from profiles where id = u;
  perform public._notify(p.user_id, 'gift', uname || ' আপনাকে ' || qty || 'টি ' || g.icon || ' ' || g.name || ' পাঠিয়েছে',
                         'আপনি পাবেন ৳' || round(creator_part / 100.0, 2), json_build_object('post_id', p_post)::jsonb);
  return json_build_object('ok', true, 'coin_balance', w.coin_balance - total_coins, 'gift', g.icon, 'qty', qty);
end $$;

-- ---------- contests ----------
create or replace function public.contests_list() returns table(id bigint, title text, description text, prize_paisa bigint, cover_url text,
  starts_at timestamptz, ends_at timestamptz, is_open boolean, entries bigint, winner_post_id bigint, joined boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.description, c.prize_paisa, c.cover_url, c.starts_at, c.ends_at,
         c.is_active and c.finished_at is null and now() between c.starts_at and c.ends_at,
         (select count(*) from posts p where p.contest_id = c.id and p.status = 'published'),
         c.winner_post_id,
         exists (select 1 from posts p where p.contest_id = c.id and p.user_id = auth.uid() and p.status in ('pending','published'))
  from contests c
  where c.is_active or c.finished_at > now() - interval '30 days'
  order by (c.finished_at is null) desc, c.ends_at desc limit 50;
$$;

create or replace function public.admin_save_contest(p_id bigint, p_title text, p_description text, p_prize_paisa bigint,
                                                     p_starts timestamptz, p_ends timestamptz, p_active boolean, p_cover_url text)
returns bigint language plpgsql security definer set search_path = public as $$
declare id_ bigint;
begin
  perform public._require_admin();
  if p_ends <= coalesce(p_starts, now()) then raise exception 'BAD_DATES'; end if;
  if p_id is null then
    insert into contests (title, description, prize_paisa, starts_at, ends_at, is_active, cover_url)
    values (trim(p_title), nullif(trim(p_description), ''), greatest(coalesce(p_prize_paisa, 0), 0), coalesce(p_starts, now()), p_ends, coalesce(p_active, true), nullif(p_cover_url, ''))
    returning id into id_;
  else
    update contests set title = trim(p_title), description = nullif(trim(p_description), ''), prize_paisa = greatest(coalesce(p_prize_paisa, 0), 0),
           starts_at = coalesce(p_starts, starts_at), ends_at = p_ends, is_active = coalesce(p_active, is_active), cover_url = nullif(p_cover_url, '')
     where id = p_id returning id into id_;
  end if;
  perform public._audit('contest_save', 'contest', id_::text, p_title, '{}'::jsonb);
  return id_;
end $$;

create or replace function public.admin_finish_contest(p_contest bigint, p_post bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c record; p record;
begin
  perform public._require_admin();
  select * into c from contests where id = p_contest for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if c.finished_at is not null then raise exception 'ALREADY_FINISHED'; end if;
  if p_post is not null then
    select id, user_id into p from posts where id = p_post and contest_id = p_contest and status = 'published';
    if not found then raise exception 'NOT_FOUND'; end if;
    if c.prize_paisa > 0 then
      perform public._wallet_move(p.user_id, 'earning', c.prize_paisa, 'contest_prize', 'contest', p_contest, '🏆 ' || c.title, 'contest:' || p_contest);
    end if;
    perform public._notify(p.user_id, 'system', '🏆 আপনি কম্পিটিশন জিতেছেন!', c.title || case when c.prize_paisa > 0 then ' — পুরস্কার ৳' || round(c.prize_paisa / 100.0, 2) else '' end,
                           json_build_object('contest_id', p_contest)::jsonb);
  end if;
  update contests set winner_post_id = p_post, finished_at = now(), is_active = false where id = p_contest;
  perform public._audit('contest_finish', 'contest', p_contest::text, coalesce(p_post::text, 'no winner'), '{}'::jsonb);
end $$;

create or replace function public.admin_post_action(p_id bigint, p_action text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  perform public._require_admin();
  select * into p from posts where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action = 'approve' then update posts set status = 'published', reject_reason = null where id = p_id;
  elsif p_action = 'reject' then update posts set status = 'rejected', reject_reason = p_reason where id = p_id;
    perform public._notify(p.user_id, 'system', 'আপনার একটি পোস্ট সরানো হয়েছে', coalesce(p_reason, ''), json_build_object('post_id', p_id)::jsonb);
  elsif p_action = 'delete' then update posts set status = 'deleted', reject_reason = p_reason where id = p_id;
    perform public._notify(p.user_id, 'system', 'আপনার একটি পোস্ট মুছে ফেলা হয়েছে', coalesce(p_reason, ''), json_build_object('post_id', p_id)::jsonb);
  elsif p_action = 'restore' then update posts set status = 'published', reject_reason = null where id = p_id;
  else raise exception 'BAD_ACTION'; end if;
  perform public._audit('post_' || p_action, 'post', p_id::text, p_reason, '{}'::jsonb);
end $$;

-- ---------- messages ----------
create or replace function public.send_message(p_to uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); id_ bigint; b text := nullif(trim(p_body), '');
begin
  if coalesce(public.setting_text('dm_enabled'), 'true') <> 'true' and not public.is_admin() then raise exception 'DM_OFF'; end if;
  if b is null then raise exception 'EMPTY_TEXT'; end if;
  if p_to = u then raise exception 'SELF'; end if;
  if not exists (select 1 from profiles where id = p_to and status = 'active') then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from messages where sender_id = u and created_at > now() - interval '1 minute') >= 20 then raise exception 'TRY_LATER'; end if;
  insert into messages (sender_id, receiver_id, body) values (u, p_to, left(b, 1000)) returning id into id_;
  return id_;
end $$;

create or replace function public.my_chats() returns table(other_id uuid, username text, full_name text, avatar_url text,
  last_body text, last_at timestamptz, last_from_me boolean, unread bigint)
language sql stable security definer set search_path = public as $$
  with m as (
    select case when sender_id = auth.uid() then receiver_id else sender_id end as other, *
    from messages where sender_id = auth.uid() or receiver_id = auth.uid()
  ), last as (
    select distinct on (other) other, body, created_at, sender_id = auth.uid() as mine from m order by other, id desc
  )
  select l.other, p.username, p.full_name, p.avatar_url, l.body, l.created_at, l.mine,
         (select count(*) from messages x where x.sender_id = l.other and x.receiver_id = auth.uid() and x.read_at is null)
  from last l join profiles p on p.id = l.other order by l.created_at desc limit 100;
$$;

create or replace function public.chat_messages(p_with uuid, p_before bigint default null) returns setof messages
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  update messages set read_at = now() where receiver_id = auth.uid() and sender_id = p_with and read_at is null;
  return query select * from (
    select * from messages
     where ((sender_id = auth.uid() and receiver_id = p_with) or (sender_id = p_with and receiver_id = auth.uid()))
       and (p_before is null or id < p_before)
     order by id desc limit 60) t order by id;
end $$;

create or replace function public.msg_unread() returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from messages where receiver_id = auth.uid() and read_at is null;
$$;

-- ---------- profile cover ----------
create or replace function public.set_cover(p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  if p_url is not null and p_url not like '%/storage/v1/object/public/avatars/' || u::text || '/%' then raise exception 'BAD_URL'; end if;
  update profiles set cover_url = p_url where id = u;
end $$;

-- ---------- premium: hosts need admin-approved access; uploading premium is for hosts ----------
create or replace function public._premium_free(p_video_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = p_video_owner or public.is_admin()
      or exists (select 1 from profiles where id = auth.uid() and account_type = 'host' and premium_access);
$$;

create or replace function public.set_video_premium(p_video bigint, p_premium boolean, p_coins int)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  if p_premium and not public.is_admin() and coalesce(public.setting_text('premium_upload_hosts_only'), 'true') = 'true'
     and (select account_type from profiles where id = u) <> 'host' then
    raise exception 'HOST_ONLY';
  end if;
  update videos set is_premium = coalesce(p_premium, false),
         premium_coins = case when p_premium then greatest(1, least(coalesce(p_coins, public.setting_int('premium_default_coins')::int), 100000)) end
   where id = p_video and (user_id = u or public.is_admin());
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create or replace function public.set_account_type(p_type text) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  if p_type = 'user' then
    update profiles set account_type = 'user', host_requested_at = null, premium_access = false where id = u; return 'user';
  elsif p_type = 'host' then
    if (select account_type from profiles where id = u) = 'host' then return 'host'; end if;
    if coalesce(public.setting_text('host_auto_approve'), 'false') = 'true' then
      update profiles set account_type = 'host', host_requested_at = null where id = u; return 'host';
    end if;
    update profiles set host_requested_at = coalesce(host_requested_at, now()) where id = u; return 'pending';
  end if;
  raise exception 'BAD_TYPE';
end $$;

create or replace function public.admin_set_premium_access(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  update profiles set premium_access = coalesce(p_on, false) where id = p_user;
  perform public._notify(p_user, 'system', case when p_on then '👑 আপনি এখন প্রিমিয়াম ভিডিও ফ্রি দেখতে পারবেন' else 'প্রিমিয়াম ফ্রি দেখার অনুমতি বন্ধ' end, '', '{}'::jsonb);
  perform public._audit(case when p_on then 'premium_access_on' else 'premium_access_off' end, 'user', p_user::text, null, '{}'::jsonb);
end $$;

-- ---------- usage tracking + analytics ----------
create or replace function public.track_time(p_sec int) returns void
language sql security definer set search_path = public as $$
  insert into app_usage (user_id, day, seconds)
  select auth.uid(), public.today_bd(), least(greatest(coalesce(p_sec, 0), 0), 120) where auth.uid() is not null
  on conflict (user_id, day) do update set seconds = least(app_usage.seconds + excluded.seconds, 86400);
$$;

create or replace function public.admin_analytics(p_days int default 7) returns json
language plpgsql stable security definer set search_path = public as $$
declare d0 date := public.today_bd() - (greatest(coalesce(p_days, 7), 1) - 1); r json;
begin
  perform public._require_admin();
  select json_build_object(
    'days', greatest(coalesce(p_days, 7), 1),
    'usage', (select json_build_object('seconds', coalesce(sum(seconds), 0), 'users', count(distinct user_id),
                'today_seconds', coalesce(sum(seconds) filter (where day = public.today_bd()), 0),
                'today_users', count(distinct user_id) filter (where day = public.today_bd()))
              from app_usage where day >= d0),
    'daily', (select coalesce(json_agg(x order by x.day), '[]') from (
                select g.day::date as day, coalesce(sum(a.seconds), 0) as seconds, count(a.user_id) as users
                from generate_series(d0, public.today_bd(), interval '1 day') g(day)
                left join app_usage a on a.day = g.day::date group by g.day) x),
    'top_users', (select coalesce(json_agg(x), '[]') from (
                select p.user_no, p.username, p.country_code, sum(a.seconds) as seconds
                from app_usage a join profiles p on p.id = a.user_id where a.day >= d0
                group by p.id order by sum(a.seconds) desc limit 15) x),
    'categories', (select coalesce(json_agg(x order by x.views_period desc), '[]') from (
                select c.*, (select count(*) from video_views vv join videos v2 on v2.id = vv.video_id
                              where coalesce(v2.category, 'other') = c.category and vv.view_date >= d0) as views_period
                from (select coalesce(v.category, 'other') as category, count(*) as videos, coalesce(sum(v.views_count), 0) as views,
                             coalesce(sum(v.likes_count), 0) as likes, coalesce(sum(v.comments_count), 0) as comments,
                             coalesce(sum(v.gifts_coins_total), 0) as gift_coins, count(*) filter (where v.is_premium) as premium
                      from videos v where v.status = 'published' group by coalesce(v.category, 'other')) c) x),
    'posts', (select coalesce(json_agg(x), '[]') from (
                select kind, coalesce(category, '-') as category, count(*) as posts, coalesce(sum(likes_count), 0) as likes,
                       coalesce(sum(comments_count), 0) as comments, coalesce(sum(shares_count), 0) as shares
                from posts where status = 'published' group by kind, coalesce(category, '-') order by sum(likes_count) desc) x),
    'countries', (select coalesce(json_agg(x order by x.users desc), '[]') from (
                select coalesce(p.country_code, '??') as country_code, count(*) as users,
                       count(*) filter (where exists (select 1 from app_usage a where a.user_id = p.id and a.day >= d0)) as active,
                       count(*) filter (where p.account_type = 'host') as hosts
                from profiles p where p.status = 'active' group by coalesce(p.country_code, '??')) x)
  ) into r;
  return r;
end $$;

-- grants
do $$
declare f text;
begin
  foreach f in array array[
    'public._post_earn(uuid, text, text, bigint, text)',
    'public.create_post(text, text, text, text, text, text, bigint)',
    'public.feed_posts(text, bigint, int, text, bigint, uuid, text)',
    'public.toggle_post_like(bigint)', 'public.add_post_comment(bigint, text)', 'public.post_comments_list(bigint)',
    'public.delete_post_comment(bigint)', 'public.record_post_share(bigint)', 'public.delete_post(bigint)',
    'public.send_post_gift(bigint, int, int, text)', 'public.contests_list()',
    'public.admin_save_contest(bigint, text, text, bigint, timestamptz, timestamptz, boolean, text)',
    'public.admin_finish_contest(bigint, bigint)', 'public.admin_post_action(bigint, text, text)',
    'public.send_message(uuid, text)', 'public.my_chats()', 'public.chat_messages(uuid, bigint)', 'public.msg_unread()',
    'public.set_cover(text)', 'public.admin_set_premium_access(uuid, boolean)', 'public.track_time(int)', 'public.admin_analytics(int)',
    'public._premium_free(uuid)', 'public.set_video_premium(bigint, boolean, int)', 'public.set_account_type(text)'
  ] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  execute 'revoke all on function public._post_earn(uuid, text, text, bigint, text) from authenticated';
end $$;
