-- 021: coin offers (admin-defined packs: price in taka → coins) + cash-in with offer
create table if not exists public.coin_offers (
  id bigint generated always as identity primary key,
  title text not null,
  coins bigint not null check (coins > 0),
  price_taka int not null check (price_taka > 0),
  badge text,
  active boolean not null default true,
  ends_at timestamptz,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.coin_offers enable row level security;
drop policy if exists coin_offers_read on public.coin_offers;
create policy coin_offers_read on public.coin_offers for select to authenticated
  using (active and (ends_at is null or ends_at > now()));
grant select on public.coin_offers to authenticated;

alter table public.cash_in_requests add column if not exists offer_id bigint references public.coin_offers(id);

drop function if exists public.request_cash_in(text, int, text, text);
create or replace function public.request_cash_in(p_method text, p_amount_taka int, p_sender text, p_trx text, p_offer_id bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); r_id bigint; coins bigint; o record;
begin
  if p_method not in ('bkash','nagad','rocket') then raise exception 'BAD_METHOD'; end if;
  if p_sender !~ '^01[3-9][0-9]{8}$' then raise exception 'BAD_NUMBER'; end if;
  if length(trim(coalesce(p_trx, ''))) < 6 then raise exception 'BAD_TRX'; end if;
  if (select count(*) from cash_in_requests where user_id = u and status = 'pending') >= 3 then
    raise exception 'TOO_MANY_PENDING';
  end if;
  if p_offer_id is not null then
    select * into o from coin_offers where id = p_offer_id;
    if not found or not o.active or (o.ends_at is not null and o.ends_at <= now()) then raise exception 'OFFER_ENDED'; end if;
    if p_amount_taka <> o.price_taka then raise exception 'OFFER_PRICE_MISMATCH'; end if;
    coins := o.coins;
  else
    if p_amount_taka < public.setting_int('min_cash_in_taka') then raise exception 'BELOW_MIN'; end if;
    coins := floor(p_amount_taka * 100.0 / greatest(public.setting_int('coin_price_paisa'), 1));
  end if;
  begin
    insert into cash_in_requests (user_id, method, amount_paisa, coins, sender_number, trx_id, offer_id)
    values (u, p_method, p_amount_taka * 100, coins, p_sender, upper(trim(p_trx)), p_offer_id)
    returning id into r_id;
  exception when unique_violation then
    raise exception 'TRX_USED';
  end;
  return r_id;
end $$;
revoke all on function public.request_cash_in(text, int, text, text, bigint) from public, anon;
grant execute on function public.request_cash_in(text, int, text, text, bigint) to authenticated;

-- admin: list / save / delete (delete only disables if already used)
create or replace function public.admin_coin_offers() returns setof json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query select json_build_object('id', o.id, 'title', o.title, 'coins', o.coins, 'price_taka', o.price_taka, 'badge', o.badge,
    'active', o.active, 'ends_at', o.ends_at, 'sort', o.sort, 'created_at', o.created_at,
    'sold', (select count(*) from cash_in_requests c where c.offer_id = o.id and c.status = 'approved'),
    'pending', (select count(*) from cash_in_requests c where c.offer_id = o.id and c.status = 'pending'))
  from coin_offers o order by o.active desc, o.sort, o.id desc;
end $$;

create or replace function public.admin_save_coin_offer(p_id bigint, p_title text, p_coins bigint, p_price_taka int,
  p_badge text, p_active boolean, p_ends_at timestamptz, p_sort int) returns bigint
language plpgsql security definer set search_path = public as $$
declare r bigint;
begin
  perform public._require_admin();
  if coalesce(trim(p_title), '') = '' or p_coins < 1 or p_price_taka < 1 then raise exception 'BAD_INPUT'; end if;
  if p_id is null then
    insert into coin_offers (title, coins, price_taka, badge, active, ends_at, sort)
    values (trim(p_title), p_coins, p_price_taka, nullif(trim(p_badge), ''), coalesce(p_active, true), p_ends_at, coalesce(p_sort, 0))
    returning id into r;
  else
    update coin_offers set title = trim(p_title), coins = p_coins, price_taka = p_price_taka, badge = nullif(trim(p_badge), ''),
      active = coalesce(p_active, true), ends_at = p_ends_at, sort = coalesce(p_sort, 0) where id = p_id returning id into r;
    if r is null then raise exception 'NOT_FOUND'; end if;
  end if;
  perform public._audit('coin_offer', 'coin_offer', r::text, null, json_build_object('title', p_title, 'coins', p_coins, 'price', p_price_taka, 'active', p_active)::jsonb);
  return r;
end $$;

create or replace function public.admin_delete_coin_offer(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if exists (select 1 from cash_in_requests where offer_id = p_id) then
    update coin_offers set active = false where id = p_id; return 'disabled';
  end if;
  delete from coin_offers where id = p_id; return 'deleted';
end $$;

revoke all on function public.admin_coin_offers() from public, anon;
revoke all on function public.admin_save_coin_offer(bigint, text, bigint, int, text, boolean, timestamptz, int) from public, anon;
revoke all on function public.admin_delete_coin_offer(bigint) from public, anon;
grant execute on function public.admin_coin_offers() to authenticated;
grant execute on function public.admin_save_coin_offer(bigint, text, bigint, int, text, boolean, timestamptz, int) to authenticated;
grant execute on function public.admin_delete_coin_offer(bigint) to authenticated;
