-- 049: ইউজার ব্লক (Google Play UGC নিয়ম): ব্লক করলে মেসেজ/কল বন্ধ, অ্যাপে তার কনটেন্ট লুকানো
create table if not exists public.user_blocks (
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
alter table public.user_blocks enable row level security;
drop policy if exists ub_sel on public.user_blocks;
create policy ub_sel on public.user_blocks for select using (blocker = auth.uid());

create or replace function public._is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;
revoke all on function public._is_blocked(uuid, uuid) from public, anon, authenticated;

create or replace function public.block_user(p_user uuid, p_on boolean default true) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user();
begin
  if p_user is null or p_user = u then raise exception 'BAD_USER'; end if;
  if p_on then
    insert into user_blocks (blocker, blocked) values (u, p_user) on conflict do nothing;
    delete from follows where (follower_id = u and following_id = p_user) or (follower_id = p_user and following_id = u);
  else
    delete from user_blocks where blocker = u and blocked = p_user;
  end if;
  return p_on;
end $$;

create or replace function public.my_blocks() returns table (user_id uuid, username text, full_name text, avatar_url text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.blocked, p.username, p.full_name, p.avatar_url, b.created_at
  from user_blocks b join profiles p on p.id = b.blocked where b.blocker = auth.uid() order by b.created_at desc;
$$;
grant execute on function public.block_user(uuid, boolean), public.my_blocks() to authenticated;
revoke execute on function public.block_user(uuid, boolean), public.my_blocks() from anon;

-- মেসেজ ও কলে ব্লক চেক (ফাংশনের শুরুতে বসানো)
do $do$
declare d text; f regprocedure;
begin
  foreach f in array array['public.send_message(uuid,text,bigint)'::regprocedure, 'public.call_start(uuid,text)'::regprocedure] loop
    d := pg_get_functiondef(f);
    if position('_is_blocked' in d) = 0 then
      d := regexp_replace(d, '\nbegin\n', E'\nbegin\n  if public._is_blocked(auth.uid(), ' ||
        case when f::text like '%send_message%' then 'p_to' else 'p_callee' end || E') then raise exception ''BLOCKED''; end if;\n', '');
      execute d;
    end if;
  end loop;
end $do$;
