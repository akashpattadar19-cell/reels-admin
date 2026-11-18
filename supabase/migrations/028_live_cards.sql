-- 028: live cards like the home grid (photo snapshot, language, level, call info) + "is this user live" lookup
alter table live_rooms add column if not exists thumb_url text;

create or replace function public.live_set_thumb(p_room bigint, p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_url is null or p_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/photos/' then raise exception 'BAD_URL'; end if;
  update live_rooms set thumb_url = p_url where id = p_room and host_id = auth.uid() and status = 'live';
end $$;

drop function if exists public.list_lives(integer);
create function public.list_lives(p_limit integer default 40)
returns table(id bigint, host_id uuid, title text, started_at timestamptz, viewers int, likes int, username text, full_name text, avatar_url text,
  cover_url text, thumb_url text, country_code text, language text, level int, account_type text, following boolean, in_pk boolean,
  calls_on boolean, call_video_rate int, call_audio_rate int)
language sql stable security definer set search_path = public as $$
  select r.id, r.host_id, r.title, r.started_at, _live_viewers_now(r.id), r.likes, p.username, p.full_name, p.avatar_url, p.cover_url, r.thumb_url,
         up.country_code, p.language, _level(p.followers_count), p.account_type,
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = r.host_id), r.pk_id is not null,
         coalesce(p.calls_on, true), p.call_video_rate, p.call_audio_rate
  from live_rooms r join profiles p on p.id = r.host_id left join user_private up on up.user_id = r.host_id
  where r.status = 'live' and r.host_seen > now() - interval '90 seconds'
  order by exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = r.host_id) desc, _live_viewers_now(r.id) desc, r.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.user_live(p_user uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', r.id, 'thumb_url', r.thumb_url, 'title', r.title)
  from live_rooms r where r.host_id = p_user and r.status = 'live' and r.host_seen > now() - interval '90 seconds'
  order by r.id desc limit 1;
$$;
revoke all on function public.list_lives(integer), public.user_live(uuid), public.live_set_thumb(bigint, text) from public, anon;
grant execute on function public.list_lives(integer), public.user_live(uuid), public.live_set_thumb(bigint, text) to authenticated;
