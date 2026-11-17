-- Reels Enjoy: core schema
-- টাকা সব paisa (BIGINT); ১ টাকা = ১০০ পয়সা

create extension if not exists pg_cron;

-- ========== USERS ==========
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text unique not null check (username ~ '^[a-z0-9_.]{3,30}$'),
  full_name       text,
  avatar_url      text,
  bio             text check (char_length(bio) <= 300),
  role            text not null default 'user' check (role in ('user','admin')),
  status          text not null default 'active' check (status in ('active','banned')),
  ban_reason      text,
  is_verified     boolean not null default false,
  followers_count int not null default 0,
  following_count int not null default 0,
  videos_count    int not null default 0,
  created_at      timestamptz not null default now()
);

-- ফোন নম্বর আলাদা টেবিলে (সবাই দেখতে পাবে না)
create table public.user_private (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  phone      text unique not null,
  device_id  text,
  last_seen  timestamptz
);

create table public.follows (
  follower_id  uuid references public.profiles(id) on delete cascade,
  following_id uuid references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

-- ========== CONTENT ==========
create table public.videos (
  id                bigserial primary key,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  caption           text check (char_length(caption) <= 2200),
  video_path        text not null,
  video_url         text not null,
  thumb_url         text,
  duration_sec      int,
  status            text not null default 'published'
                    check (status in ('published','rejected','deleted')),
  reject_reason     text,
  is_featured       boolean not null default false,
  uploaded_by_admin boolean not null default false,
  allow_comments    boolean not null default true,
  allow_gifts       boolean not null default true,
  views_count       bigint not null default 0,
  likes_count       int not null default 0,
  comments_count    int not null default 0,
  shares_count      int not null default 0,
  gifts_coins_total bigint not null default 0,
  created_at        timestamptz not null default now()
);
create index on public.videos (status, id desc);
create index on public.videos (user_id, id desc);
create index on public.videos (is_featured) where is_featured;

create table public.hashtags (
  id        bigserial primary key,
  tag       text unique not null,
  use_count int not null default 0
);
create table public.video_hashtags (
  video_id   bigint references public.videos(id) on delete cascade,
  hashtag_id bigint references public.hashtags(id) on delete cascade,
  primary key (video_id, hashtag_id)
);

create table public.video_views (
  id         bigserial primary key,
  video_id   bigint not null references public.videos(id) on delete cascade,
  viewer_id  uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  watch_ms   int not null,
  view_date  date not null default (now() at time zone 'Asia/Dhaka')::date,
  created_at timestamptz not null default now(),
  unique (video_id, viewer_id, view_date)
);
create index on public.video_views (viewer_id, created_at);

create table public.likes (
  user_id    uuid references public.profiles(id) on delete cascade,
  video_id   bigint references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
-- আনলাইক-রিলাইকে ডবল ইনকাম ঠেকাতে
create table public.like_rewards (
  user_id  uuid,
  video_id bigint,
  primary key (user_id, video_id)
);

create table public.comments (
  id         bigserial primary key,
  video_id   bigint not null references public.videos(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  status     text not null default 'visible' check (status in ('visible','hidden')),
  created_at timestamptz not null default now()
);
create index on public.comments (video_id, id desc);
create table public.comment_rewards (
  video_id bigint,
  user_id  uuid,
  primary key (video_id, user_id)
);

create table public.shares (
  id         bigserial primary key,
  video_id   bigint not null references public.videos(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ========== GIFTS ==========
create table public.gift_categories (
  id         serial primary key,
  name       text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true
);
create table public.gifts (
  id                serial primary key,
  category_id       int references public.gift_categories(id) on delete set null,
  name              text not null,
  icon              text not null,             -- emoji বা ছবির URL
  coin_price        int not null check (coin_price > 0),
  creator_share_pct numeric(5,2) not null default 70 check (creator_share_pct between 0 and 100),
  is_active         boolean not null default true,
  sort_order        int not null default 0
);
create table public.gift_transactions (
  id                   bigserial primary key,
  gift_id              int not null references public.gifts(id),
  sender_id            uuid not null references public.profiles(id),
  receiver_id          uuid not null references public.profiles(id),
  video_id             bigint references public.videos(id) on delete set null,
  quantity             int not null,
  total_coins          bigint not null,
  creator_amount_paisa bigint not null,
  platform_fee_paisa   bigint not null,
  idem_key             text unique not null,
  created_at           timestamptz not null default now(),
  check (sender_id <> receiver_id)
);
create index on public.gift_transactions (receiver_id, created_at desc);
create index on public.gift_transactions (created_at);

-- ========== WALLET ==========
create table public.wallets (
  user_id               uuid primary key references public.profiles(id) on delete cascade,
  coin_balance          bigint not null default 0 check (coin_balance >= 0),
  earning_paisa         bigint not null default 0 check (earning_paisa >= 0),
  pending_paisa         bigint not null default 0 check (pending_paisa >= 0),
  points                bigint not null default 0 check (points >= 0),
  total_earned_paisa    bigint not null default 0,
  total_withdrawn_paisa bigint not null default 0,
  is_frozen             boolean not null default false,
  updated_at            timestamptz not null default now()
);

create table public.transactions (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  type          text not null,      -- view_earning, like_earning, comment_earning, gift_sent, gift_received,
                                    -- watch_reward, ad_reward_viewer, ad_reward_creator, points_convert,
                                    -- pending_release, cash_in, withdraw_hold, withdraw_refund, admin_adjust
  bucket        text not null check (bucket in ('coin','earning','pending','points')),
  amount        bigint not null,
  balance_after bigint not null,
  ref_type      text,
  ref_id        bigint,
  note          text,
  available_at  timestamptz,        -- pending হলে কখন available হবে
  released      boolean not null default false,
  idem_key      text unique,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index on public.transactions (user_id, id desc);
create index on public.transactions (available_at) where bucket = 'pending' and not released;

create table public.cash_in_requests (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  method        text not null check (method in ('bkash','nagad','rocket')),
  amount_paisa  bigint not null check (amount_paisa > 0),
  coins         bigint not null,
  sender_number text not null,
  trx_id        text unique not null,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  reviewed_by   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on public.cash_in_requests (status, id);

create table public.withdraw_requests (
  id             bigserial primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  amount_paisa   bigint not null check (amount_paisa > 0),
  fee_paisa      bigint not null default 0,
  payable_paisa  bigint not null,
  method         text not null check (method in ('bkash','nagad','rocket')),
  account_number text not null,
  account_name   text,
  status         text not null default 'pending' check (status in ('pending','approved','paid','rejected')),
  reject_reason  text,
  payout_trx_id  text,
  reviewed_by    uuid references public.profiles(id),
  reviewed_at    timestamptz,
  paid_at        timestamptz,
  created_at     timestamptz not null default now()
);
create unique index uq_open_withdraw on public.withdraw_requests (user_id)
  where status in ('pending','approved');
create index on public.withdraw_requests (status, id);

-- ========== ADS ==========
create table public.ad_placements (
  key             text primary key,   -- feed_native, feed_interstitial, rewarded_points
  ad_type         text not null check (ad_type in ('native','interstitial','rewarded','banner')),
  unit_id_android text,
  unit_id_ios     text,
  every_n_videos  int,
  viewer_points   int not null default 0,
  creator_points  int not null default 0,
  daily_cap       int,
  is_active       boolean not null default true
);
create table public.ad_rewards (
  id             bigserial primary key,
  ssv_tx_id      text unique not null,
  placement_key  text not null,
  viewer_id      uuid references public.profiles(id) on delete set null,
  video_id       bigint references public.videos(id) on delete set null,
  creator_id     uuid references public.profiles(id) on delete set null,
  viewer_points  int not null,
  creator_points int not null,
  created_at     timestamptz not null default now()
);
create index on public.ad_rewards (viewer_id, created_at);

-- ========== SYSTEM ==========
create table public.notifications (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}',
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, id desc);

create table public.content_reports (
  id          bigserial primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('video','comment','user')),
  target_id   text not null,
  reason      text not null,
  status      text not null default 'open' check (status in ('open','resolved','dismissed')),
  handled_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table public.audit_logs (
  id          bigserial primary key,
  admin_id    uuid references public.profiles(id),
  action      text not null,
  target_type text,
  target_id   text,
  reason      text,
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create table public.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  is_public   boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table public.creator_daily_stats (
  user_id             uuid references public.profiles(id) on delete cascade,
  stat_date           date not null,
  valid_views         int not null default 0,
  view_paisa_credited bigint not null default 0,
  likes               int not null default 0,
  comments            int not null default 0,
  gift_paisa          bigint not null default 0,
  primary key (user_id, stat_date)
);
create index on public.creator_daily_stats (stat_date);

create table public.viewer_daily_points (
  user_id   uuid references public.profiles(id) on delete cascade,
  stat_date date not null,
  points    int not null default 0,
  primary key (user_id, stat_date)
);
