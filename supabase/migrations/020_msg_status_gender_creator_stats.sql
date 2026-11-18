-- 020: message delivered/seen/edit/reply, profile gender + photo removal, creator dashboard stats

-- ---------- messages ----------
alter table messages add column if not exists delivered_at timestamptz,
                     add column if not exists edited_at timestamptz,
                     add column if not exists reply_to bigint references messages(id) on delete set null;

drop function if exists public.send_message(uuid, text);
create or replace function public.send_message(p_to uuid, p_body text, p_reply_to bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); id_ bigint; b text := nullif(trim(p_body), '');
begin
  if coalesce(public.setting_text('dm_enabled'), 'true') <> 'true' and not public.is_admin() then raise exception 'DM_OFF'; end if;
  if b is null then raise exception 'EMPTY_TEXT'; end if;
  if p_to = u then raise exception 'SELF'; end if;
  if not exists (select 1 from profiles where id = p_to and status = 'active') then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from messages where sender_id = u and created_at > now() - interval '1 minute') >= 20 then raise exception 'TRY_LATER'; end if;
  if p_reply_to is not null and not exists (select 1 from messages where id = p_reply_to
       and ((sender_id = u and receiver_id = p_to) or (sender_id = p_to and receiver_id = u))) then p_reply_to := null; end if;
  insert into messages (sender_id, receiver_id, body, reply_to) values (u, p_to, left(b, 1000), p_reply_to) returning id into id_;
  return id_;
end $$;

create or replace function public.edit_message(p_id bigint, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); b text := nullif(trim(p_body), '');
begin
  if b is null then raise exception 'EMPTY_TEXT'; end if;
  update messages set body = left(b, 1000), edited_at = now()
   where id = p_id and sender_id = u and created_at > now() - interval '24 hours';
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create or replace function public.delete_message(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from messages where id = p_id and sender_id = auth.uid();
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- receiver's app is online → mark delivered (✓✓)
create or replace function public.mark_delivered() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update messages set delivered_at = now() where receiver_id = auth.uid() and delivered_at is null;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.chat_messages(p_with uuid, p_before bigint default null)
returns setof messages language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  update messages set read_at = now(), delivered_at = coalesce(delivered_at, now())
   where receiver_id = auth.uid() and sender_id = p_with and read_at is null;
  return query select * from (
    select * from messages
     where ((sender_id = auth.uid() and receiver_id = p_with) or (sender_id = p_with and receiver_id = auth.uid()))
       and (p_before is null or id < p_before)
     order by id desc limit 80) t order by id;
end $$;

create or replace function public.mark_read(p_with uuid) returns void
language sql security definer set search_path = public as $$
  update messages set read_at = now(), delivered_at = coalesce(delivered_at, now())
   where receiver_id = auth.uid() and sender_id = p_with and read_at is null;
$$;

drop function if exists public.my_chats();
create or replace function public.my_chats()
returns table(other_id uuid, username text, full_name text, avatar_url text, last_body text, last_at timestamptz,
              last_from_me boolean, unread bigint, last_status text)
language sql stable security definer set search_path = public as $$
  with m as (
    select case when sender_id = auth.uid() then receiver_id else sender_id end as other, *
    from messages where sender_id = auth.uid() or receiver_id = auth.uid()
  ), last as (
    select distinct on (other) other, body, created_at, sender_id = auth.uid() as mine,
           case when read_at is not null then 'seen' when delivered_at is not null then 'delivered' else 'sent' end as st
    from m order by other, id desc
  )
  select l.other, p.username, p.full_name, p.avatar_url, l.body, l.created_at, l.mine,
         (select count(*) from messages x where x.sender_id = l.other and x.receiver_id = auth.uid() and x.read_at is null), l.st
  from last l join profiles p on p.id = l.other order by l.created_at desc limit 100;
$$;

-- ---------- profile ----------
alter table profiles add column if not exists gender text check (gender in ('male','female','other'));
create or replace function public.set_gender(p_gender text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_gender is not null and p_gender not in ('male','female','other') then raise exception 'BAD_GENDER'; end if;
  update profiles set gender = p_gender where id = public._active_user();
end $$;
create or replace function public.remove_photo(p_which text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  if p_which = 'avatar' then update profiles set avatar_url = null where id = u;
  elsif p_which = 'cover' then update profiles set cover_url = null where id = u;
  else raise exception 'BAD_KIND'; end if;
end $$;

-- ---------- creator dashboard ----------
create or replace function public.creator_stats(p_days int default 30) returns json
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); since date := public.today_bd() - greatest(1, least(coalesce(p_days, 30), 365)) + 1;
        rate numeric := public.setting_int('view_rate_paisa_per_1000');
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  return json_build_object(
    'days', p_days,
    'totals', (select json_build_object(
        'videos', count(*), 'views', coalesce(sum(views_count), 0), 'likes', coalesce(sum(likes_count), 0),
        'comments', coalesce(sum(comments_count), 0), 'shares', coalesce(sum(shares_count), 0),
        'downloads', coalesce(sum(downloads_count), 0), 'gift_coins', coalesce(sum(gifts_coins_total), 0))
        from videos where user_id = u and status = 'published'),
    'followers', (select followers_count from profiles where id = u),
    'period_views', (select count(*) from video_views where creator_id = u and view_date >= since),
    'earned', (select json_build_object(
        'total', coalesce(sum(amount), 0),
        'views', coalesce(sum(amount) filter (where type = 'view_earning'), 0),
        'likes', coalesce(sum(amount) filter (where type = 'like_earning'), 0),
        'comments', coalesce(sum(amount) filter (where type = 'comment_earning'), 0),
        'gifts', coalesce(sum(amount) filter (where type = 'gift_received'), 0),
        'posts', coalesce(sum(amount) filter (where type like 'post_%'), 0),
        'referral', coalesce(sum(amount) filter (where type like 'referral%'), 0))
        from transactions where user_id = u and amount > 0 and created_at >= since
          and type in ('view_earning','like_earning','comment_earning','gift_received','post_like_earning','post_comment_earning',
                       'post_share_earning','referral_bonus','referral_tier_bonus')),
    'daily', (select coalesce(json_agg(json_build_object('day', d, 'views', coalesce(v.c, 0)) order by d), '[]')
        from generate_series(greatest(since, public.today_bd() - 13), public.today_bd(), interval '1 day') g(d)
        left join (select view_date, count(*) c from video_views where creator_id = u and view_date >= since group by 1) v on v.view_date = g.d::date),
    'gender', (select coalesce(json_agg(x), '[]') from (
        select coalesce(p.gender, 'unknown') as gender, count(*) as views
        from video_views vv join profiles p on p.id = vv.viewer_id
        where vv.creator_id = u and vv.view_date >= since group by 1 order by 2 desc) x),
    'countries', (select coalesce(json_agg(x), '[]') from (
        select coalesce(p.country_code, '??') as country_code, count(*) as views
        from video_views vv join profiles p on p.id = vv.viewer_id
        where vv.creator_id = u and vv.view_date >= since group by 1 order by 2 desc limit 6) x),
    'videos', (select coalesce(json_agg(x order by x.earn_paisa desc, x.views desc), '[]') from (
        select v.id, v.caption, v.thumb_url, v.created_at, v.views_count as views, v.likes_count as likes,
               v.comments_count as comments, v.shares_count as shares, v.downloads_count as downloads, v.is_premium,
               (select count(*) from video_views vv where vv.video_id = v.id and vv.view_date >= since) as period_views,
               (select count(*) from video_views vv join profiles p on p.id = vv.viewer_id where vv.video_id = v.id and p.gender = 'male') as male,
               (select count(*) from video_views vv join profiles p on p.id = vv.viewer_id where vv.video_id = v.id and p.gender = 'female') as female,
               floor((select count(*) from video_views vv where vv.video_id = v.id) * rate / 1000.0)::bigint as view_paisa,
               coalesce((select sum(t.amount) from transactions t where t.user_id = u and t.ref_type = 'video' and t.ref_id = v.id and t.amount > 0), 0)
                 + coalesce((select sum(g.creator_amount_paisa) from gift_transactions g where g.video_id = v.id and g.receiver_id = u), 0) as other_paisa,
               floor((select count(*) from video_views vv where vv.video_id = v.id) * rate / 1000.0)::bigint
                 + coalesce((select sum(t.amount) from transactions t where t.user_id = u and t.ref_type = 'video' and t.ref_id = v.id and t.amount > 0), 0)
                 + coalesce((select sum(g.creator_amount_paisa) from gift_transactions g where g.video_id = v.id and g.receiver_id = u), 0) as earn_paisa
        from videos v where v.user_id = u and v.status = 'published' order by v.id desc limit 100) x)
  );
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.send_message(uuid, text, bigint)', 'public.edit_message(bigint, text)', 'public.delete_message(bigint)',
    'public.mark_delivered()', 'public.chat_messages(uuid, bigint)', 'public.mark_read(uuid)', 'public.my_chats()',
    'public.set_gender(text)', 'public.remove_photo(text)', 'public.creator_stats(int)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
