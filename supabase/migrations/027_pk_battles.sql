-- 027: Live PK battles (two live hosts, viewers gift to make their host win; winner gets a bonus from the platform)
insert into settings (key, value) values ('pk_enabled', 'true'), ('pk_duration_sec', '300'), ('pk_winner_bonus_pct', '10'), ('pk_bonus_cap_paisa', '50000')
on conflict (key) do nothing;

create table if not exists pk_battles (
  id bigserial primary key,
  room_a bigint not null references live_rooms(id) on delete cascade,
  room_b bigint not null references live_rooms(id) on delete cascade,
  host_a uuid not null references profiles(id) on delete cascade,
  host_b uuid not null references profiles(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','active','ended','declined','cancelled')),
  duration_sec int not null default 300,
  created_at timestamptz not null default now(),
  started_at timestamptz, ends_at timestamptz, ended_at timestamptz,
  score_a bigint not null default 0, score_b bigint not null default 0,
  winner uuid, bonus_paisa bigint not null default 0, end_reason text
);
create index if not exists pk_battles_status on pk_battles(status);
alter table pk_battles enable row level security;
drop policy if exists pk_read on pk_battles;
create policy pk_read on pk_battles for select to authenticated using (true);
grant select on pk_battles to authenticated;
alter table live_rooms add column if not exists pk_id bigint;
do $$ begin alter publication supabase_realtime add table pk_battles; exception when others then null; end $$;

create or replace function public._pk_settle(p_pk bigint, p_reason text default 'time') returns json
language plpgsql security definer set search_path = public as $$
declare b record; win uuid; wscore bigint; bonus bigint := 0;
begin
  select * into b from pk_battles where id = p_pk for update;
  if not found then return null; end if;
  if b.status = 'invited' then
    update pk_battles set status = 'cancelled', ended_at = now(), end_reason = p_reason where id = p_pk;
    return json_build_object('status', 'cancelled');
  end if;
  if b.status <> 'active' then return json_build_object('status', b.status, 'winner', b.winner, 'bonus', b.bonus_paisa); end if;
  if b.score_a > b.score_b then win := b.host_a; wscore := b.score_a;
  elsif b.score_b > b.score_a then win := b.host_b; wscore := b.score_b; end if;
  if win is not null then
    bonus := least(floor(wscore * setting_int('coin_price_paisa') * setting_int('pk_winner_bonus_pct') / 100.0)::bigint, setting_int('pk_bonus_cap_paisa'));
    if bonus > 0 then
      perform _wallet_move(win, 'pending', bonus, 'pk_bonus', 'pk', p_pk, '⚔️ PK জয়ের বোনাস', 'pk-bonus:' || p_pk,
        now() + make_interval(hours => setting_int('pending_hold_hours')::int), null);
    end if;
  end if;
  update pk_battles set status = 'ended', ended_at = now(), winner = win, bonus_paisa = bonus, end_reason = p_reason where id = p_pk;
  update live_rooms set pk_id = null where pk_id = p_pk;
  insert into live_messages (room_id, user_id, username, kind, body)
  select x, null, '⚔️ PK', 'system', case when win is null then 'PK ড্র হয়েছে 🤝' else '🏆 ' || (select username from profiles where id = win) || ' PK জিতেছে!' end
  from unnest(array[b.room_a, b.room_b]) x;
  return json_build_object('status', 'ended', 'winner', win, 'bonus', bonus);
end $$;

create or replace function public.pk_candidates(p_room bigint) returns table(room_id bigint, host_id uuid, username text, full_name text, avatar_url text, viewers int, title text)
language sql stable security definer set search_path = public as $$
  select r.id, r.host_id, p.username, p.full_name, p.avatar_url, _live_viewers_now(r.id), r.title
  from live_rooms r join profiles p on p.id = r.host_id
  where r.status = 'live' and r.pk_id is null and r.id <> p_room and r.host_seen > now() - interval '90 seconds'
    and exists (select 1 from live_rooms m where m.id = p_room and m.host_id = auth.uid())
  order by _live_viewers_now(r.id) desc limit 30;
$$;

create or replace function public.pk_invite(p_room bigint, p_target bigint) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := _active_user(); a record; t record; pid bigint; uname text;
begin
  if not coalesce((select (value)::text::boolean from settings where key = 'pk_enabled'), true) then raise exception 'PK_OFF'; end if;
  select * into a from live_rooms where id = p_room and host_id = u and status = 'live' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into t from live_rooms where id = p_target and status = 'live' for update;
  if not found or t.host_id = u then raise exception 'LIVE_ENDED'; end if;
  if a.pk_id is not null or t.pk_id is not null then raise exception 'PK_BUSY'; end if;
  update pk_battles set status = 'cancelled', ended_at = now(), end_reason = 'replaced' where status = 'invited' and host_a = u;
  insert into pk_battles (room_a, room_b, host_a, host_b, duration_sec) values (p_room, p_target, u, t.host_id, greatest(setting_int('pk_duration_sec'), 60)) returning id into pid;
  select username into uname from profiles where id = u;
  perform _notify(t.host_id, 'pk', '⚔️ PK চ্যালেঞ্জ', '@' || uname || ' আপনাকে PK ব্যাটলে ডেকেছে', json_build_object('pk', pid)::jsonb);
  return json_build_object('pk_id', pid);
end $$;

create or replace function public.pk_answer(p_pk bigint, p_accept boolean) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := _active_user(); b record;
begin
  select * into b from pk_battles where id = p_pk for update;
  if not found or b.host_b <> u then raise exception 'NOT_FOUND'; end if;
  if b.status <> 'invited' or b.created_at < now() - interval '40 seconds' then raise exception 'PK_EXPIRED'; end if;
  if not p_accept then update pk_battles set status = 'declined', ended_at = now() where id = p_pk; return json_build_object('status', 'declined'); end if;
  if exists (select 1 from live_rooms where id in (b.room_a, b.room_b) and (status <> 'live' or pk_id is not null)) then
    update pk_battles set status = 'cancelled', ended_at = now(), end_reason = 'busy' where id = p_pk; raise exception 'PK_BUSY'; end if;
  update pk_battles set status = 'active', started_at = now(), ends_at = now() + make_interval(secs => duration_sec) where id = p_pk;
  update live_rooms set pk_id = p_pk where id in (b.room_a, b.room_b);
  insert into live_messages (room_id, user_id, username, kind, body)
  select x, null, '⚔️ PK', 'system', 'PK ব্যাটল শুরু! গিফট দিয়ে আপনার হোস্টকে জেতান 🔥' from unnest(array[b.room_a, b.room_b]) x;
  return json_build_object('status', 'active');
end $$;

-- either host ends early, or anyone calls after time is over
create or replace function public.pk_finish(p_pk bigint) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); b record;
begin
  select * into b from pk_battles where id = p_pk;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.status = 'active' and b.ends_at <= now() then return _pk_settle(p_pk, 'time'); end if;
  if u in (b.host_a, b.host_b) and b.status in ('invited','active') then return _pk_settle(p_pk, 'host'); end if;
  return json_build_object('status', b.status, 'winner', b.winner, 'bonus', b.bonus_paisa, 'ends_at', b.ends_at);
end $$;

create or replace function public.admin_pk_recent() returns json
language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin();
  return coalesce((select json_agg(x) from (
    select b.id, b.status, b.started_at, b.score_a, b.score_b, b.bonus_paisa, b.end_reason,
      pa.username a, pa.user_no a_no, pb.username b, pb.user_no b_no, pw.username winner
    from pk_battles b join profiles pa on pa.id = b.host_a join profiles pb on pb.id = b.host_b left join profiles pw on pw.id = b.winner
    where b.status in ('active','ended') order by b.id desc limit 50) x), '[]'::json);
end $$;

revoke all on function public._pk_settle(bigint, text) from public, anon, authenticated;
revoke all on function public.pk_candidates(bigint), public.pk_invite(bigint, bigint), public.pk_answer(bigint, boolean), public.pk_finish(bigint), public.admin_pk_recent() from public, anon;
grant execute on function public.pk_candidates(bigint), public.pk_invite(bigint, bigint), public.pk_answer(bigint, boolean), public.pk_finish(bigint), public.admin_pk_recent() to authenticated;

-- score: live_gift adds coins to the active battle
do $$ declare d text; begin
  d := pg_get_functiondef('public.live_gift(bigint,integer,integer,text)'::regprocedure);
  d := replace(d, 'update live_rooms set gift_coins = gift_coins + total_coins, host_earned_paisa = host_earned_paisa + host_part where id = p_room;',
   'update live_rooms set gift_coins = gift_coins + total_coins, host_earned_paisa = host_earned_paisa + host_part where id = p_room;
  if r.pk_id is not null then
    update pk_battles set score_a = score_a + case when room_a = p_room then total_coins else 0 end,
                          score_b = score_b + case when room_b = p_room then total_coins else 0 end
     where id = r.pk_id and status = ''active'' and ends_at > now();
  end if;');
  execute d;
  d := pg_get_functiondef('public.live_end(bigint,text)'::regprocedure);
  d := replace(d, 'update live_cohosts set status = ''ended'' where room_id = p_room and status in (''pending'',''accepted'');',
   'update live_cohosts set status = ''ended'' where room_id = p_room and status in (''pending'',''accepted'');
  perform public._pk_settle(id, ''left'') from pk_battles where (room_a = p_room or room_b = p_room) and status in (''invited'',''active'');');
  execute d;
end $$;

-- cron: settle finished battles, drop stale invites, battles whose room ended
create or replace function public._pk_cron() returns void language plpgsql security definer set search_path = public as $$
begin
  perform _pk_settle(id, 'time') from pk_battles where status = 'active' and ends_at <= now();
  perform _pk_settle(id, 'timeout') from pk_battles where status = 'invited' and created_at < now() - interval '40 seconds';
  perform _pk_settle(b.id, 'left') from pk_battles b where b.status = 'active'
    and exists (select 1 from live_rooms r where r.id in (b.room_a, b.room_b) and r.status <> 'live');
end $$;
revoke all on function public._pk_cron() from public, anon, authenticated;
select cron.schedule('pk-cron', '* * * * *', 'select public._pk_cron()');
