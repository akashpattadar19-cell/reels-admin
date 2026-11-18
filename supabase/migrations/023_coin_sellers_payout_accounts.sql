-- 023: coin sellers (host + admin permission) and saved withdraw numbers. Applied as migration "coin_sellers_payout_accounts".
alter table public.profiles add column if not exists coin_seller boolean not null default false,
  add column if not exists seller_commission_pct int check (seller_commission_pct between 0 and 100),
  add column if not exists seller_note text;

insert into settings (key, value, description, is_public) values
  ('coin_seller_enabled', 'true', 'হোস্ট কয়েন সেলার চালু', true),
  ('seller_commission_pct', '5', 'সেলারের প্রতিটি বিক্রিতে এডমিনের কমিশন (%) — সেলারের স্টক থেকে বাড়তি কাটা হয়', true)
on conflict (key) do nothing;

create table if not exists public.coin_sales (
  id bigint generated always as identity primary key,
  seller_id uuid not null references profiles(id),
  buyer_id uuid not null references profiles(id),
  coins bigint not null check (coins > 0),
  commission_coins bigint not null default 0,
  taka_paisa bigint,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists coin_sales_seller on public.coin_sales (seller_id, id desc);
create index if not exists coin_sales_buyer on public.coin_sales (buyer_id, id desc);
alter table public.coin_sales enable row level security;
drop policy if exists coin_sales_own on public.coin_sales;
create policy coin_sales_own on public.coin_sales for select to authenticated using (seller_id = auth.uid() or buyer_id = auth.uid());
grant select on public.coin_sales to authenticated;

-- seller_sell_coins(p_user_no, p_coins, p_taka, p_note): seller must be coin_seller AND host. Deducts coins + ceil(coins*pct/100)
--   commission from the seller's coin_balance (pct = profiles.seller_commission_pct or setting seller_commission_pct),
--   credits buyer coins. Ledger types: seller_sale, seller_commission, seller_buy (ref coin_sale).
-- seller_summary(): stock, pct, today/total stats, recent 50 sales.
-- admin_set_coin_seller(user, on, pct), admin_coin_sellers(), admin_coin_sales(seller, limit).
-- payout_accounts (user, method bkash|nagad|rocket, account, name; max 5) + add_payout_account / delete_payout_account.
-- Full bodies: see the applied migration in Supabase (list_migrations → coin_sellers_payout_accounts).
