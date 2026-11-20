-- 048: 💎 ধনী লেভেল (কয়েন কেনা বা খরচের যেটা বেশি) + বন্ধুর কয়েন কেনায় রেফারকারীর কমিশন (কয়েন)
alter table profiles add column if not exists wealth_topup bigint not null default 0;
alter table profiles add column if not exists wealth_spent bigint not null default 0;

insert into settings (key, value, description) values
  ('wealth_levels', '[1000,3000,10000,30000,100000,300000,1000000,3000000,10000000,30000000]', 'ধনী লেভেল Lv1…Lv10: কত কয়েন কেনা বা খরচ (যেটা বেশি)'),
  ('wealth_enabled', 'true', 'ধনী লেভেলের ব্যাজ দেখাবে'),
  ('ref_topup_pct', '10', 'রেফার করা বন্ধু কয়েন কিনলে রেফারকারী কত % কয়েন পাবে (০ = বন্ধ)')
on conflict (key) do nothing;

-- কয়েন কেনা (টপ-আপ) = cash_in, play_purchase, seller_buy। খরচ = কয়েনের সব কাটা, শুধু সেলারের বিক্রি/কমিশন আর অ্যাডমিন অ্যাডজাস্ট বাদে।
-- আগের হিসাব
update profiles p set
  wealth_topup = coalesce((select sum(amount) from transactions t where t.user_id = p.id and t.bucket = 'coin' and t.amount > 0 and t.type in ('cash_in','play_purchase','seller_buy')), 0),
  wealth_spent = coalesce((select -sum(amount) from transactions t where t.user_id = p.id and t.bucket = 'coin' and t.amount < 0 and t.type not in ('seller_sale','seller_commission','admin_adjust','admin_coin_grant')), 0);

create or replace function public._ref_topup_bonus(p_user uuid, p_coins bigint, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare me record; r record; pct numeric := coalesce(setting_int('ref_topup_pct'), 0); b bigint;
begin
  if pct <= 0 or p_coins <= 0 then return; end if;
  select id, username, referred_by, referral_blocked into me from profiles where id = p_user;
  if me.referred_by is null or me.referred_by = p_user or me.referral_blocked = 'same_device' then return; end if;
  select id, status into r from profiles where id = me.referred_by;
  if r.id is null or r.status <> 'active' then return; end if;
  b := floor(p_coins * pct / 100);
  if b <= 0 then return; end if;
  perform _wallet_move(r.id, 'coin', b, 'ref_topup_bonus', 'user', null, '@' || me.username || ' কয়েন কিনেছে', 'rtb:' || coalesce(p_ref, gen_random_uuid()::text));
  perform _notify(r.id, 'system', '🎁 বন্ধু @' || me.username || ' কয়েন কিনেছে', 'আপনি পেয়েছেন 🪙 ' || b || ' কয়েন', '{}'::jsonb);
end $$;
revoke all on function public._ref_topup_bonus(uuid, bigint, text) from public, anon, authenticated;

-- _wallet_move: ধনী লেভেলের হিসাব + বন্ধুর কেনায় কমিশন
do $$
declare d text := pg_get_functiondef('public._wallet_move(uuid,text,bigint,text,text,bigint,text,text,timestamptz,uuid)'::regprocedure);
begin
  if position('wealth_topup' in d) > 0 then return; end if;
  d := replace(d, '  return v_after;
end', '  if p_bucket = ''coin'' then
    if p_amount > 0 and p_type in (''cash_in'', ''play_purchase'', ''seller_buy'') then
      update profiles set wealth_topup = wealth_topup + p_amount where id = p_user;
    elsif p_amount < 0 and p_type not in (''seller_sale'', ''seller_commission'', ''admin_adjust'', ''admin_coin_grant'') then
      update profiles set wealth_spent = wealth_spent - p_amount where id = p_user;
    end if;
    if p_amount > 0 and p_type in (''cash_in'', ''play_purchase'') then
      perform public._ref_topup_bonus(p_user, p_amount, coalesce(p_idem, p_type || '':'' || coalesce(p_ref_id::text, '''')));
    end if;
  end if;
  return v_after;
end');
  if position('wealth_topup' in d) = 0 then raise exception 'patch failed'; end if;
  execute d;
end $$;
