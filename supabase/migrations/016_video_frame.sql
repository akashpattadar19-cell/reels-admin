-- 016: chosen frame size for videos (orig / 1:1 / 9:16 / 16:9 / 3:4 / 4:3), returned by feed
alter table videos add column if not exists frame text check (frame in ('orig','1:1','9:16','16:9','3:4','4:3'));

create or replace function public.set_video_frame(p_video bigint, p_frame text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_frame is not null and p_frame not in ('orig','1:1','9:16','16:9','3:4','4:3') then raise exception 'BAD_FRAME'; end if;
  update videos set frame = nullif(p_frame, 'orig') where id = p_video and (user_id = public._active_user() or public.is_admin());
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;
revoke all on function public.set_video_frame(bigint, text) from public, anon;
grant execute on function public.set_video_frame(bigint, text) to authenticated;

drop function if exists public.feed(text, bigint, int, uuid, text, text, text);
create or replace function public.feed(p_type text default 'foryou', p_before bigint default null, p_limit int default 10,
                                       p_user uuid default null, p_category text default null,
                                       p_lang text default null, p_country text default null)
returns table(id bigint, user_id uuid, username text, full_name text, avatar_url text, is_verified boolean, caption text,
              video_url text, thumb_url text, views_count bigint, likes_count int, comments_count int, shares_count int,
              gifts_coins_total bigint, allow_comments boolean, allow_gifts boolean, is_featured boolean,
              created_at timestamptz, liked_by_me boolean, following boolean, category text,
              country_code text, language text, level int, account_type text,
              is_premium boolean, premium_coins int, locked boolean, frame text)
language sql stable security definer set search_path = public as $$
  with me as (select country_code from profiles where id = auth.uid())
  select v.id, v.user_id, p.username, p.full_name, p.avatar_url, p.is_verified, v.caption,
         case when lk.locked then null else v.video_url end,
         v.thumb_url, v.views_count, v.likes_count, v.comments_count, v.shares_count, v.gifts_coins_total,
         v.allow_comments, v.allow_gifts, v.is_featured, v.created_at,
         exists (select 1 from likes l where l.video_id = v.id and l.user_id = auth.uid()),
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = v.user_id),
         v.category, p.country_code, p.language, public._level(p.followers_count), p.account_type,
         v.is_premium, v.premium_coins, lk.locked, v.frame
  from videos v join profiles p on p.id = v.user_id
  cross join lateral (select v.is_premium and not public._premium_free(v.user_id)
                        and not exists (select 1 from premium_unlocks u where u.user_id = auth.uid() and u.video_id = v.id) as locked) lk
  where v.status = 'published' and p.status = 'active'
    and (p_before is null or v.id < p_before)
    and (p_user is null or v.user_id = p_user)
    and (p_category is null or p_category = '' or (p_category = 'premium' and v.is_premium) or v.category = p_category)
    and (p_lang is null or p_lang = '' or p.language = p_lang)
    and (p_country is null or p_country = '' or p.country_code = p_country)
    and (p_type <> 'following' or exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = v.user_id))
    and (p_type <> 'nearby' or p.country_code = (select country_code from me))
  order by v.id desc
  limit least(greatest(p_limit, 1), 30);
$$;
revoke all on function public.feed(text, bigint, int, uuid, text, text, text) from public, anon;
grant execute on function public.feed(text, bigint, int, uuid, text, text, text) to authenticated;
