-- 029: voice Party rooms (audio only, host + seats). Reuses live_rooms (kind='party'), live_cohosts (= seats), live_messages, live_gift.
insert into settings (key, value) values ('party_enabled', 'true'), ('party_hosts_only', 'true'), ('party_max_seats', '8'), ('party_gift_pct', '0')
on conflict (key) do nothing;
alter table live_rooms add column if not exists kind text not null default 'live';
alter table live_rooms add column if not exists seats int not null default 0;
alter table live_rooms add column if not exists free_seats boolean not null default false;
alter table live_cohosts add column if not exists muted boolean not null default false;
alter table live_cohosts add column if not exists seat int;
do $$ begin alter table live_rooms add constraint live_rooms_kind_chk check (kind in ('live','party')); exception when duplicate_object then null; end $$;

create or replace function public.party_start(p_title text, p_seats int default 8) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := _active_user(); p record; r bigint; s int;
begin
  if coalesce(setting_text('party_enabled'), 'true') <> 'true' then raise exception 'PARTY_OFF'; end if;
  select * into p from profiles where id = u;
  if coalesce(setting_text('party_hosts_only'), 'true') = 'true' and p.account_type <> 'host' and p.role <> 'admin' then raise exception 'HOST_ONLY'; end if;
  s := least(greatest(coalesce(p_seats, 8), 1), greatest(setting_int('party_max_seats'), 1));
  update live_rooms set status = 'ended', ended_at = now(), ended_reason = 'restart' where host_id = u and status = 'live';
  insert into live_rooms (host_id, title, kind, seats) values (u, left(nullif(trim(p_title), ''), 80), 'party', s) returning id into r;
  insert into live_messages (room_id, user_id, username, kind, body) values (r, u, p.username, 'system', '🎉 পার্টি শুরু হয়েছে');
  return json_build_object('room_id', r, 'channel', 'live_' || r, 'seats', s);
end $$;

-- seat limit per room kind; free seats = sit without asking
create or replace function public._seat_free(p_room bigint) returns int language sql stable security definer set search_path = public as $$
  select (select min(x) from generate_series(1, case when r.kind = 'party' then r.seats else greatest(setting_int('live_max_cohosts'), 0) end) x
          where not exists (select 1 from live_cohosts c where c.room_id = r.id and c.status = 'accepted' and c.seat = x))
  from live_rooms r where r.id = p_room;
$$;

create or replace function public.live_answer_cohost(p_room bigint, p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r record; uname text; s int;
begin
  select * into r from live_rooms where id = p_room;
  if not found or (r.host_id <> auth.uid() and not is_admin()) then raise exception 'NOT_FOUND'; end if;
  if p_accept then
    if exists (select 1 from live_cohosts where room_id = p_room and user_id = p_user and status = 'accepted') then return; end if;
    s := _seat_free(p_room);
    if s is null then raise exception 'COHOST_FULL'; end if;
  end if;
  update live_cohosts set status = case when p_accept then 'accepted' else (case when status = 'accepted' then 'ended' else 'rejected' end) end,
    seat = case when p_accept then s else seat end, muted = false
    where room_id = p_room and user_id = p_user;
  select username into uname from profiles where id = p_user;
  if p_accept then insert into live_messages (room_id, user_id, username, kind, body)
    values (p_room, p_user, uname, 'system', case when r.kind = 'party' then '🎤 সিটে বসেছে' else '🎤 লাইভে যোগ দিয়েছে' end); end if;
end $$;

create or replace function public.live_request_cohost(p_room bigint) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := _active_user(); r record; uname text; s int;
begin
  select * into r from live_rooms where id = p_room;
  if not found or r.status <> 'live' then raise exception 'LIVE_ENDED'; end if;
  if r.host_id = u then return; end if;
  if exists (select 1 from live_cohosts where room_id = p_room and user_id = u and status = 'accepted') then return; end if;
  select username into uname from profiles where id = u;
  if r.kind = 'party' and r.free_seats then
    s := _seat_free(p_room);
    if s is null then raise exception 'COHOST_FULL'; end if;
    insert into live_cohosts (room_id, user_id, status, seat) values (p_room, u, 'accepted', s)
      on conflict (room_id, user_id) do update set status = 'accepted', seat = s, muted = false, created_at = now();
    insert into live_messages (room_id, user_id, username, kind, body) values (p_room, u, uname, 'system', '🎤 সিটে বসেছে');
    return;
  end if;
  insert into live_cohosts (room_id, user_id) values (p_room, u) on conflict (room_id, user_id) do update set status = 'pending', created_at = now();
  insert into live_messages (room_id, user_id, username, kind, body) values (p_room, u, uname, 'system', case when r.kind = 'party' then '🙋 সিটে বসতে চায়' else '🙋 যোগ দিতে চায়' end);
end $$;

create or replace function public.party_settings(p_room bigint, p_free boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update live_rooms set free_seats = coalesce(p_free, free_seats) where id = p_room and host_id = auth.uid() and kind = 'party';
end $$;

create or replace function public.party_mute(p_room bigint, p_user uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from live_rooms where id = p_room and (host_id = auth.uid() or is_admin())) and p_user <> auth.uid() then raise exception 'NOT_FOUND'; end if;
  update live_cohosts set muted = p_muted where room_id = p_room and user_id = p_user and status = 'accepted';
end $$;

-- gifts can go to the host or anyone on a seat
drop function if exists public.live_gift(bigint, integer, integer, text);
create function public.live_gift(p_room bigint, p_gift_id integer, p_qty integer, p_idem text, p_to uuid default null) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := _active_user(); g record; r record; w record; gt record; qty int; total_coins bigint; total_paisa bigint; pct int; part bigint; uname text; rc uuid;
begin
  if p_idem is null or length(p_idem) < 8 then raise exception 'BAD_IDEM'; end if;
  if exists (select 1 from gift_transactions where idem_key = p_idem) then
    return json_build_object('ok', true, 'duplicate', true, 'coin_balance', (select coin_balance from wallets where user_id = u)); end if;
  select * into g from gifts where id = p_gift_id and is_active;
  if not found then raise exception 'GIFT_NOT_FOUND'; end if;
  select * into r from live_rooms where id = p_room;
  if not found or r.status <> 'live' then raise exception 'LIVE_ENDED'; end if;
  rc := coalesce(p_to, r.host_id);
  if rc <> r.host_id and not exists (select 1 from live_cohosts where room_id = p_room and user_id = rc and status = 'accepted') then raise exception 'NOT_FOUND'; end if;
  if rc = u then raise exception 'SELF_GIFT'; end if;
  qty := least(greatest(coalesce(p_qty, 1), 1), 99);
  total_coins := g.coin_price::bigint * qty;
  total_paisa := total_coins * setting_int('coin_price_paisa');
  pct := case when r.kind = 'party' and setting_int('party_gift_pct') > 0 then least(setting_int('party_gift_pct'), 100)::int
              when setting_int('live_gift_host_pct') > 0 then least(setting_int('live_gift_host_pct'), 100)::int
              else _gift_pct(rc, g.creator_share_pct) end;
  part := floor(total_paisa * pct / 100);
  perform 1 from wallets where user_id in (u, rc) order by user_id for update;
  select * into w from wallets where user_id = u;
  if coalesce(w.coin_balance, 0) < total_coins then raise exception 'INSUFFICIENT_COINS'; end if;
  insert into gift_transactions (gift_id, sender_id, receiver_id, video_id, live_room_id, quantity, total_coins, creator_amount_paisa, platform_fee_paisa, idem_key)
  values (g.id, u, rc, null, p_room, qty, total_coins, part, total_paisa - part, p_idem) returning * into gt;
  perform _wallet_move(u, 'coin', -total_coins, 'gift_sent', 'gift_tx', gt.id, (case when r.kind = 'party' then '🎉 ' else '🔴 ' end) || g.icon || ' ' || g.name || ' x' || qty, 'gift-s:' || p_idem);
  perform _wallet_move(rc, 'pending', part, 'gift_received', 'gift_tx', gt.id, (case when r.kind = 'party' then '🎉 পার্টি ' else '🔴 লাইভ ' end) || g.icon || ' x' || qty, 'gift-r:' || p_idem,
                       now() + make_interval(hours => setting_int('pending_hold_hours')::int));
  update live_rooms set gift_coins = gift_coins + total_coins, host_earned_paisa = host_earned_paisa + case when rc = r.host_id then part else 0 end where id = p_room;
  if r.pk_id is not null then
    update pk_battles set score_a = score_a + case when room_a = p_room then total_coins else 0 end,
                          score_b = score_b + case when room_b = p_room then total_coins else 0 end
     where id = r.pk_id and status = 'active' and ends_at > now();
  end if;
  select username into uname from profiles where id = u;
  insert into live_messages (room_id, user_id, username, kind, body)
  values (p_room, u, uname, 'gift', g.icon || ' ' || g.name || ' x' || qty || case when rc <> r.host_id then ' → @' || (select username from profiles where id = rc) else '' end);
  return json_build_object('ok', true, 'coin_balance', w.coin_balance - total_coins, 'gift', g.icon, 'qty', qty);
end $$;

drop function if exists public.list_lives(integer);
create function public.list_lives(p_limit integer default 40)
returns table(id bigint, host_id uuid, title text, started_at timestamptz, viewers int, likes int, username text, full_name text, avatar_url text,
  cover_url text, thumb_url text, country_code text, language text, level int, account_type text, following boolean, in_pk boolean,
  calls_on boolean, call_video_rate int, call_audio_rate int, kind text, on_seats int, seats int)
language sql stable security definer set search_path = public as $$
  select r.id, r.host_id, r.title, r.started_at, _live_viewers_now(r.id), r.likes, p.username, p.full_name, p.avatar_url, p.cover_url, r.thumb_url,
         up.country_code, p.language, _level(p.followers_count), p.account_type,
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = r.host_id), r.pk_id is not null,
         coalesce(p.calls_on, true), p.call_video_rate, p.call_audio_rate, r.kind,
         (select count(*)::int from live_cohosts c where c.room_id = r.id and c.status = 'accepted'), r.seats
  from live_rooms r join profiles p on p.id = r.host_id left join user_private up on up.user_id = r.host_id
  where r.status = 'live' and r.host_seen > now() - interval '90 seconds'
  order by exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = r.host_id) desc, _live_viewers_now(r.id) desc, r.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.user_live(p_user uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', r.id, 'thumb_url', r.thumb_url, 'title', r.title, 'kind', r.kind)
  from live_rooms r where r.host_id = p_user and r.status = 'live' and r.host_seen > now() - interval '90 seconds'
  order by r.id desc limit 1;
$$;

revoke all on function public._seat_free(bigint) from public, anon, authenticated;
revoke all on function public.party_start(text, int), public.party_settings(bigint, boolean), public.party_mute(bigint, uuid, boolean),
  public.live_gift(bigint, integer, integer, text, uuid), public.list_lives(integer), public.user_live(uuid) from public, anon;
grant execute on function public.party_start(text, int), public.party_settings(bigint, boolean), public.party_mute(bigint, uuid, boolean),
  public.live_gift(bigint, integer, integer, text, uuid), public.list_lives(integer), public.user_live(uuid) to authenticated;
