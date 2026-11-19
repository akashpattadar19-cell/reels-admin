-- 036: Google Play Billing coin packages + Chamet-style coin page settings
create table if not exists public.play_products (
  id serial primary key,
  product_id text not null unique,          -- Play Console in-app product ID (e.g. coins_100)
  coins int not null check (coins > 0),     -- coins the buyer receives
  base_coins int,                           -- optional crossed-out number (shows the bonus)
  badge text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.play_products enable row level security;
drop policy if exists play_products_read on public.play_products;
create policy play_products_read on public.play_products for select to authenticated using (active or public.is_admin());

create table if not exists public.play_purchases (
  purchase_token text primary key,
  user_id uuid not null references public.profiles(id),
  product_id text not null,
  order_id text,
  coins int not null,
  status text not null default 'granted',   -- granted | refunded
  created_at timestamptz not null default now()
);
create index if not exists play_purchases_user on public.play_purchases(user_id, created_at desc);
alter table public.play_purchases enable row level security;
drop policy if exists play_purchases_read on public.play_purchases;
create policy play_purchases_read on public.play_purchases for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- called only by the play-purchase edge function (service role) after Google confirms the purchase
create or replace function public.grant_play_purchase(p_user uuid, p_product text, p_token text, p_order text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_coins int; v_bal bigint;
begin
  if exists (select 1 from play_purchases where purchase_token = p_token) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  select coins into v_coins from play_products where product_id = p_product;
  if v_coins is null then raise exception 'UNKNOWN_PRODUCT'; end if;
  insert into play_purchases (purchase_token, user_id, product_id, order_id, coins) values (p_token, p_user, p_product, p_order, v_coins);
  perform _wallet_move(p_user, 'coin', v_coins, 'play_purchase', 'play', null, coalesce(p_order, p_product), 'play:' || p_token);
  perform _notify(p_user, 'cash_in', '🪙 কয়েন যোগ হয়েছে', v_coins || ' কয়েন আপনার অ্যাকাউন্টে যোগ হয়েছে', '{}'::jsonb);
  select coin_balance into v_bal from wallets where user_id = p_user;
  return jsonb_build_object('ok', true, 'coins', v_coins, 'balance', v_bal);
end $$;
revoke execute on function public.grant_play_purchase(uuid, text, text, text) from public, anon, authenticated;

-- admin: list / save / delete packages
create or replace function public.admin_save_play_product(p_id int, p_product_id text, p_coins int, p_base int, p_badge text, p_sort int, p_active boolean)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  perform _require_admin();
  if coalesce(trim(p_product_id), '') = '' or p_coins is null or p_coins <= 0 then raise exception 'BAD_INPUT'; end if;
  if p_id is null then
    insert into play_products (product_id, coins, base_coins, badge, sort, active)
    values (lower(trim(p_product_id)), p_coins, nullif(p_base, 0), nullif(trim(p_badge), ''), coalesce(p_sort, 0), coalesce(p_active, true)) returning id into v;
  else
    update play_products set product_id = lower(trim(p_product_id)), coins = p_coins, base_coins = nullif(p_base, 0),
      badge = nullif(trim(p_badge), ''), sort = coalesce(p_sort, 0), active = coalesce(p_active, true) where id = p_id returning id into v;
  end if;
  perform _audit('play_product_save', 'play_products', v::text, null, jsonb_build_object('product', p_product_id, 'coins', p_coins));
  return v;
end $$;

create or replace function public.admin_delete_play_product(p_id int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin();
  if exists (select 1 from play_purchases pp join play_products p on p.product_id = pp.product_id where p.id = p_id) then
    update play_products set active = false where id = p_id;     -- keep history of used packages
  else
    delete from play_products where id = p_id;
  end if;
end $$;

create or replace function public.admin_play_purchases(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin();
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select pp.created_at, pp.product_id, pp.coins, pp.order_id, pp.status, pr.user_no, pr.username
    from play_purchases pp join profiles pr on pr.id = pp.user_id order by pp.created_at desc limit p_limit) x), '[]');
end $$;

revoke execute on function public.admin_save_play_product, public.admin_delete_play_product, public.admin_play_purchases from public, anon;
grant execute on function public.admin_save_play_product, public.admin_delete_play_product, public.admin_play_purchases to authenticated;

insert into settings (key, value) values
  ('play_billing_enabled', 'true'::jsonb),
  ('play_show_helpers', 'false'::jsonb),
  ('topup_helper_notice', to_jsonb('হেল্পারদের কাছ থেকে কিনলে বেশি ছাড় পাবেন। সরাসরি মেসেজ দিন। টাকা পাঠানোর আগে হেল্পারকে কয়েন পাঠাতে বলুন।'::text)),
  ('topup_helper_notice_en', to_jsonb('Top-up helpers give bigger discounts. Message them directly. Ask the helper to send the coins before you pay.'::text))
on conflict (key) do nothing;

insert into play_products (product_id, coins, base_coins, badge, sort) values
  ('coins_100', 100, null, null, 1),
  ('coins_330', 330, 300, null, 2),
  ('coins_1200', 1200, 1000, null, 3),
  ('coins_3750', 3750, 3000, null, 4),
  ('coins_13000', 13000, 10000, null, 5),
  ('coins_1425', 1425, 1000, '👍', 0)
on conflict (product_id) do nothing;
