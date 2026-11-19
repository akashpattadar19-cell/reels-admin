-- 042: লঞ্চ অফার — ইনকাম লক ("শীঘ্রই আসছে") + সিজন প্রতিযোগিতা (সেরা ক্রিয়েটর / সেরা রেফারকারী)

-- ===== ইনকাম লক =====
-- settings.income_locks = {views, likes, comments, watch, ads, posts, convert, upload}: true = বন্ধ (অ্যাপে 🔒 শীঘ্রই আসছে)
-- _wallet_move লক করা ধরনের আয় নীরবে বাদ দেয় (কাজটা চলে, টাকা/পয়েন্ট যোগ হয় না); পয়েন্ট → টাকা লক থাকলে INCOME_LOCKED।
insert into settings (key, value, description) values
  ('income_locks', '{"views":true,"likes":true,"comments":true,"watch":true,"ads":true,"posts":true,"convert":true,"upload":true}',
   'লক করা ইনকাম (অ্যাপে শীঘ্রই আসছে)')
on conflict (key) do nothing;

create or replace function public._income_locked(p_type text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> (case
      when p_type = 'view_earning' then 'views'
      when p_type = 'like_earning' then 'likes'
      when p_type = 'comment_earning' then 'comments'
      when p_type = 'watch_reward' then 'watch'
      when p_type in ('ad_reward_viewer', 'ad_reward_creator') then 'ads'
      when p_type in ('post_like_earning', 'post_comment_earning', 'post_share_earning') then 'posts'
      when p_type = 'points_convert' then 'convert'
      when p_type = 'upload_reward' then 'upload'
      else '-' end))::boolean
    from settings where key = 'income_locks'), false);
$$;

create or replace function public._wallet_move(p_user uuid, p_bucket text, p_amount bigint, p_type text, p_ref_type text DEFAULT NULL::text, p_ref_id bigint DEFAULT NULL::bigint, p_note text DEFAULT NULL::text, p_idem text DEFAULT NULL::text, p_available_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_by uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_after bigint; v_earned bigint := 0;
begin
  if p_amount = 0 then return null; end if;
  if p_amount > 0 and public._income_locked(p_type) then
    if p_type = 'points_convert' then raise exception 'INCOME_LOCKED'; end if;
    return null;
  end if;
  if p_idem is not null and exists (select 1 from transactions where idem_key = p_idem) then return null; end if;
  insert into wallets (user_id) values (p_user) on conflict do nothing;
  if p_amount > 0 and p_type in ('view_earning','like_earning','comment_earning','gift_received','points_convert',
                                 'referral_bonus','referral_tier_bonus','post_like_earning','post_comment_earning',
                                 'post_share_earning','contest_prize','season_prize') then
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
end $function$;

-- ===== সিজন প্রতিযোগিতা =====
create table if not exists seasons (
  id bigserial primary key,
  title text not null,
  title_en text,
  notice text,
  notice_en text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  creator_prizes integer[] not null default '{}',   -- টাকায়, ১ম, ২য়, ...
  referral_prizes integer[] not null default '{}',
  weights jsonb not null default '{"watch":1,"like":2,"comment":3,"share":5,"video":20,"referral":50,"actor_cap":50}',
  min_videos integer not null default 5,
  require_device boolean not null default true,
  frame_days integer not null default 30,             -- বিজয়ীরা ফ্রি 👑 মুকুট ফ্রেম (দিন, 0 = না)
  boost_days integer not null default 7,              -- টপ ৩-এর সর্বশেষ ভিডিও ফ্রি বুস্ট (দিন, 0 = না)
  published boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table if not exists season_excluded (
  season_id bigint not null references seasons(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (season_id, user_id)
);
create table if not exists season_winners (
  season_id bigint not null references seasons(id) on delete cascade,
  board text not null check (board in ('creator', 'referral')),
  rank integer not null,
  user_id uuid not null references profiles(id),
  score bigint not null,
  prize_paisa bigint not null,
  paid_at timestamptz not null default now(),
  primary key (season_id, board, rank)
);
alter table seasons enable row level security;
alter table season_excluded enable row level security;
alter table season_winners enable row level security;
revoke all on seasons, season_excluded, season_winners from anon, authenticated;

-- স্কোর: শুধু অন্য আসল ইউজারের কাজ (নিজের নয়, একই মোবাইলের অ্যাকাউন্ট নয়, APK লগইন থাকতে হবে যদি require_device)।
-- একজন দর্শক একজন ক্রিয়েটরকে সর্বোচ্চ actor_cap পয়েন্ট দিতে পারে (বন্ধু দিয়ে লাইক-ফার্মিং ঠেকাতে)।
create or replace function public._season_scores(p_season bigint, p_board text)
returns table (user_id uuid, score bigint, parts jsonb, eligible boolean, why text, excluded boolean)
language plpgsql stable security definer set search_path = public as $$
declare s seasons; w jsonb; cap bigint;
begin
  select * into s from seasons where id = p_season;
  if not found then return; end if;
  w := '{"watch":1,"like":2,"comment":3,"share":5,"video":20,"referral":50,"actor_cap":50}'::jsonb || s.weights;
  cap := coalesce((w->>'actor_cap')::bigint, 0);
  if p_board = 'creator' then
    return query
    with acts as (
      select v.user_id owner, vv.viewer_id actor, 'watch'::text k, count(distinct vv.video_id) n
        from video_views vv join videos v on v.id = vv.video_id
       where vv.rewarded_at >= s.starts_at and vv.rewarded_at < s.ends_at group by 1, 2
      union all
      select v.user_id, l.user_id, 'like', count(*) from likes l join videos v on v.id = l.video_id
       where l.created_at >= s.starts_at and l.created_at < s.ends_at group by 1, 2
      union all
      select v.user_id, c.user_id, 'comment', count(distinct c.video_id) from comments c join videos v on v.id = c.video_id
       where c.status = 'visible' and c.created_at >= s.starts_at and c.created_at < s.ends_at group by 1, 2
      union all
      select v.user_id, sh.user_id, 'share', count(distinct sh.video_id) from shares sh join videos v on v.id = sh.video_id
       where sh.created_at >= s.starts_at and sh.created_at < s.ends_at group by 1, 2
    ), valid as (
      select a.* from acts a
       where a.actor <> a.owner
         and exists (select 1 from profiles p where p.id = a.actor and p.status = 'active')
         and (not s.require_device or exists (select 1 from user_devices d where d.user_id = a.actor))
         and not exists (select 1 from user_devices d1 join user_devices d2 on d2.device_hash = d1.device_hash
                          where d1.user_id = a.actor and d2.user_id = a.owner)
    ), per_actor as (
      select owner, actor, sum(n * coalesce((w->>k)::bigint, 0)) pts from valid group by 1, 2
    ), act_score as (
      select owner, sum(case when cap > 0 then least(pts, cap) else pts end)::bigint pts from per_actor group by 1
    ), counts as (
      select owner, jsonb_object_agg(k, n) j from (select owner, k, sum(n)::bigint n from valid group by 1, 2) x group by 1
    ), vids as (
      select v.user_id owner, count(*)::bigint n from videos v
       where v.status = 'published' and v.approved_at >= s.starts_at and v.approved_at < s.ends_at and not v.uploaded_by_admin
       group by 1
    ), base as (
      select coalesce(a.owner, vd.owner) owner, coalesce(a.pts, 0) apts, coalesce(vd.n, 0) nv
        from act_score a full join vids vd on vd.owner = a.owner
    )
    select b.owner,
           b.apts + b.nv * coalesce((w->>'video')::bigint, 0),
           coalesce(c.j, '{}'::jsonb) || jsonb_build_object('video', b.nv),
           (b.nv >= s.min_videos and pr.status = 'active' and not pr.jailed and pr.role <> 'admin'
              and (not s.require_device or exists (select 1 from user_devices d where d.user_id = b.owner))
              and x.user_id is null),
           case when x.user_id is not null then 'excluded'
                when pr.role = 'admin' then 'admin'
                when pr.status <> 'active' or pr.jailed then 'blocked'
                when s.require_device and not exists (select 1 from user_devices d where d.user_id = b.owner) then 'no_device'
                when b.nv < s.min_videos then 'videos' end,
           x.user_id is not null
      from base b join profiles pr on pr.id = b.owner
      left join counts c on c.owner = b.owner
      left join season_excluded x on x.season_id = s.id and x.user_id = b.owner;
  else
    return query
    with refs as (
      select p.referred_by owner, count(*)::bigint n from profiles p
       where p.referred_by is not null and p.referral_qualified_at >= s.starts_at and p.referral_qualified_at < s.ends_at
         and p.referral_blocked is null
       group by 1
    )
    select r.owner, r.n * coalesce((w->>'referral')::bigint, 0), jsonb_build_object('referral', r.n),
           (pr.status = 'active' and not pr.jailed and pr.role <> 'admin'
              and (not s.require_device or exists (select 1 from user_devices d where d.user_id = r.owner))
              and x.user_id is null),
           case when x.user_id is not null then 'excluded'
                when pr.role = 'admin' then 'admin'
                when pr.status <> 'active' or pr.jailed then 'blocked'
                when s.require_device and not exists (select 1 from user_devices d where d.user_id = r.owner) then 'no_device' end,
           x.user_id is not null
      from refs r join profiles pr on pr.id = r.owner
      left join season_excluded x on x.season_id = s.id and x.user_id = r.owner;
  end if;
end $$;

-- র‍্যাংক করা তালিকা (যোগ্যরা আগে, স্কোর বেশি আগে; সমান হলে আগে যোগ দেওয়া user_no আগে)
create or replace function public._season_ranked(p_season bigint, p_board text)
returns table (rank bigint, user_id uuid, score bigint, parts jsonb, eligible boolean, why text, excluded boolean)
language sql stable security definer set search_path = public as $$
  select case when sc.eligible and sc.score > 0 then row_number() over (partition by (sc.eligible and sc.score > 0) order by sc.score desc, p.user_no) end,
         sc.user_id, sc.score, sc.parts, sc.eligible, sc.why, sc.excluded
    from public._season_scores(p_season, p_board) sc join profiles p on p.id = sc.user_id
   order by (sc.eligible and sc.score > 0) desc, sc.score desc, p.user_no;
$$;

create or replace function public._season_json(s seasons) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'title', s.title, 'title_en', s.title_en, 'notice', s.notice, 'notice_en', s.notice_en,
    'starts_at', s.starts_at, 'ends_at', s.ends_at, 'creator_prizes', to_jsonb(s.creator_prizes), 'referral_prizes', to_jsonb(s.referral_prizes),
    'weights', '{"watch":1,"like":2,"comment":3,"share":5,"video":20,"referral":50,"actor_cap":50}'::jsonb || s.weights,
    'min_videos', s.min_videos, 'require_device', s.require_device, 'frame_days', s.frame_days, 'boost_days', s.boost_days,
    'published', s.published, 'paid_at', s.paid_at,
    'state', case when s.paid_at is not null then 'paid' when not s.published then 'draft' when now() < s.starts_at then 'upcoming'
                  when now() < s.ends_at then 'running' else 'ended' end);
$$;

-- অ্যাপ: চলমান / আসছে / সদ্য শেষ হওয়া সিজন + টপ তালিকা + আমার অবস্থান
create or replace function public.season_current() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; res jsonb; b text; top jsonb; me jsonb;
begin
  if u is null then raise exception 'AUTH'; end if;
  select * into s from seasons where published and (paid_at is null or paid_at > now() - interval '7 days')
   order by (now() between starts_at and ends_at) desc, (now() < starts_at) desc, ends_at desc limit 1;
  if not found then return null; end if;
  res := public._season_json(s);
  foreach b in array array['creator', 'referral'] loop
    if (b = 'creator' and coalesce(array_length(s.creator_prizes, 1), 0) = 0)
       or (b = 'referral' and coalesce(array_length(s.referral_prizes, 1), 0) = 0) then continue; end if;
    if s.paid_at is not null then
      select coalesce(jsonb_agg(jsonb_build_object('rank', w.rank, 'score', w.score, 'prize_paisa', w.prize_paisa, 'user_id', p.id, 'user_no', p.user_no,
               'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'deco', p.deco, 'vip_until', p.vip_until) order by w.rank), '[]')
        into top from season_winners w join profiles p on p.id = w.user_id where w.season_id = s.id and w.board = b;
    else
      select coalesce(jsonb_agg(jsonb_build_object('rank', r.rank, 'score', r.score, 'user_id', p.id, 'user_no', p.user_no, 'username', p.username,
               'full_name', p.full_name, 'avatar_url', p.avatar_url, 'deco', p.deco, 'vip_until', p.vip_until) order by r.rank), '[]')
        into top from (select * from public._season_ranked(s.id, b) where rank is not null and rank <= 20) r join profiles p on p.id = r.user_id;
    end if;
    me := null;
    select jsonb_build_object('rank', r.rank, 'score', r.score, 'parts', r.parts, 'eligible', r.eligible, 'why', r.why)
      into me from public._season_ranked(s.id, b) r where r.user_id = u;
    res := res || jsonb_build_object(b, jsonb_build_object('top', top, 'me', coalesce(me, jsonb_build_object('score', 0, 'parts', '{}'::jsonb, 'eligible', false,
             'why', case when b = 'creator' then 'videos' end))));
  end loop;
  return res;
end $$;

-- ===== অ্যাডমিন =====
create or replace function public.admin_seasons() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(public._season_json(s) order by s.starts_at desc) from seasons s), '[]');
end $$;

create or replace function public.admin_save_season(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; cp int[]; rp int[];
begin
  perform public._require_admin();
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'TITLE'; end if;
  select coalesce(array_agg(x::int order by o), '{}') into cp from jsonb_array_elements_text(coalesce(p->'creator_prizes', '[]')) with ordinality t(x, o) where x::int > 0;
  select coalesce(array_agg(x::int order by o), '{}') into rp from jsonb_array_elements_text(coalesce(p->'referral_prizes', '[]')) with ordinality t(x, o) where x::int > 0;
  if v_id is not null and exists (select 1 from seasons where id = v_id and paid_at is not null) then raise exception 'ALREADY_PAID'; end if;
  if v_id is null then
    insert into seasons (title, title_en, notice, notice_en, starts_at, ends_at, creator_prizes, referral_prizes, weights, min_videos,
                         require_device, frame_days, boost_days, published)
    values (trim(p->>'title'), nullif(trim(p->>'title_en'), ''), nullif(trim(p->>'notice'), ''), nullif(trim(p->>'notice_en'), ''),
            (p->>'starts_at')::timestamptz, (p->>'ends_at')::timestamptz, cp, rp, coalesce(p->'weights', '{}'),
            coalesce((p->>'min_videos')::int, 5), coalesce((p->>'require_device')::boolean, true),
            coalesce((p->>'frame_days')::int, 30), coalesce((p->>'boost_days')::int, 7), coalesce((p->>'published')::boolean, false))
    returning id into v_id;
  else
    update seasons set title = trim(p->>'title'), title_en = nullif(trim(p->>'title_en'), ''), notice = nullif(trim(p->>'notice'), ''),
           notice_en = nullif(trim(p->>'notice_en'), ''), starts_at = (p->>'starts_at')::timestamptz, ends_at = (p->>'ends_at')::timestamptz,
           creator_prizes = cp, referral_prizes = rp, weights = coalesce(p->'weights', weights),
           min_videos = coalesce((p->>'min_videos')::int, min_videos), require_device = coalesce((p->>'require_device')::boolean, require_device),
           frame_days = coalesce((p->>'frame_days')::int, frame_days), boost_days = coalesce((p->>'boost_days')::int, boost_days),
           published = coalesce((p->>'published')::boolean, published)
     where id = v_id;
  end if;
  perform public._audit('season_save', 'season', v_id::text, null, p);
  return v_id;
end $$;

create or replace function public.admin_delete_season(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if exists (select 1 from seasons where id = p_id and paid_at is not null) then raise exception 'ALREADY_PAID'; end if;
  delete from seasons where id = p_id;
  perform public._audit('season_delete', 'season', p_id::text, null, '{}'::jsonb);
end $$;

create or replace function public.admin_season_board(p_id bigint, p_board text, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('rank', r.rank, 'score', r.score, 'parts', r.parts, 'eligible', r.eligible, 'why', r.why,
      'excluded', r.excluded, 'user_id', p.id, 'user_no', p.user_no, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
      'country_code', p.country_code,
      'shared_device', exists (select 1 from user_devices d1 join user_devices d2 on d2.device_hash = d1.device_hash and d2.user_id <> d1.user_id
                                where d1.user_id = p.id),
      'reason', (select x.reason from season_excluded x where x.season_id = p_id and x.user_id = p.id))
    order by r.rank nulls last, r.score desc)
    from (select * from public._season_ranked(p_id, p_board) limit greatest(1, least(p_limit, 300))) r join profiles p on p.id = r.user_id), '[]');
end $$;

create or replace function public.admin_season_exclude(p_id bigint, p_user uuid, p_on boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if exists (select 1 from seasons where id = p_id and paid_at is not null) then raise exception 'ALREADY_PAID'; end if;
  if p_on then
    insert into season_excluded (season_id, user_id, reason) values (p_id, p_user, nullif(trim(p_reason), ''))
    on conflict (season_id, user_id) do update set reason = excluded.reason;
  else
    delete from season_excluded where season_id = p_id and user_id = p_user;
  end if;
  perform public._audit('season_exclude', 'user', p_user::text, p_reason, jsonb_build_object('season', p_id, 'on', p_on));
end $$;

-- পুরস্কার দেওয়া: সিজন শেষ হলে অ্যাডমিন যাচাই করে এক চাপে দেয় → ব্যালেন্সে (উইথড্রযোগ্য) + নোটিফিকেশন + ফ্রেম + বুস্ট
create or replace function public.admin_season_pay(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s seasons; b text; prizes int[]; r record; total bigint := 0; cnt int := 0; crown int; vid bigint;
begin
  perform public._require_admin();
  select * into s from seasons where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.paid_at is not null then raise exception 'ALREADY_PAID'; end if;
  if now() < s.ends_at then raise exception 'NOT_ENDED'; end if;
  select id into crown from store_items where kind = 'frame' and style = 'crown' order by id limit 1;
  foreach b in array array['creator', 'referral'] loop
    prizes := case when b = 'creator' then s.creator_prizes else s.referral_prizes end;
    for r in select * from public._season_ranked(s.id, b) where rank is not null and rank <= coalesce(array_length(prizes, 1), 0) order by rank loop
      insert into season_winners (season_id, board, rank, user_id, score, prize_paisa)
      values (s.id, b, r.rank, r.user_id, r.score, prizes[r.rank]::bigint * 100);
      perform public._wallet_move(r.user_id, 'earning', prizes[r.rank]::bigint * 100, 'season_prize', 'season', s.id,
                                  s.title || ' · #' || r.rank, 'season:' || s.id || ':' || b || ':' || r.rank, null, auth.uid());
      perform public._notify(r.user_id, 'season_prize',
        '🏆 অভিনন্দন! ' || s.title || '-এ আপনি #' || r.rank,
        '৳' || prizes[r.rank] || ' আপনার ব্যালেন্সে যোগ হয়েছে',
        jsonb_build_object('season_id', s.id, 'board', b, 'rank', r.rank));
      if crown is not null and s.frame_days > 0 then
        insert into user_items (user_id, item_id, expires_at) values (r.user_id, crown, now() + make_interval(days => s.frame_days))
        on conflict (user_id, item_id) do update
          set expires_at = case when user_items.expires_at is null then null
                                else greatest(user_items.expires_at, now()) + make_interval(days => s.frame_days) end;
        update profiles set deco = coalesce(deco, '{}'::jsonb) || jsonb_build_object('frame', 'crown') where id = r.user_id;
      end if;
      if b = 'creator' and r.rank <= 3 and s.boost_days > 0 then
        vid := null;
        select id into vid from videos where user_id = r.user_id and status = 'published' order by created_at desc limit 1;
        if vid is not null then
          update videos set boost_until = greatest(coalesce(boost_until, now()), now()) + make_interval(days => s.boost_days) where id = vid;
        end if;
      end if;
      total := total + prizes[r.rank]::bigint * 100; cnt := cnt + 1;
    end loop;
  end loop;
  update seasons set paid_at = now() where id = s.id;
  perform public._audit('season_pay', 'season', s.id::text, null, jsonb_build_object('winners', cnt, 'paisa', total));
  return jsonb_build_object('winners', cnt, 'paisa', total);
end $$;

revoke all on function public._income_locked(text), public._season_scores(bigint, text), public._season_ranked(bigint, text),
  public._season_json(seasons) from public, anon, authenticated;
revoke all on function public.season_current(), public.admin_seasons(), public.admin_save_season(jsonb), public.admin_delete_season(bigint),
  public.admin_season_board(bigint, text, int), public.admin_season_exclude(bigint, uuid, boolean, text), public.admin_season_pay(bigint)
  from public, anon;
grant execute on function public.season_current(), public.admin_seasons(), public.admin_save_season(jsonb), public.admin_delete_season(bigint),
  public.admin_season_board(bigint, text, int), public.admin_season_exclude(bigint, uuid, boolean, text), public.admin_season_pay(bigint)
  to authenticated;
