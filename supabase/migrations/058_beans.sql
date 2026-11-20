-- 058: হোস্টদের My Beans (গিফট/কলের কয়েন → Beans), Beans → টাকা উইথড্র, রেফার লেভেল অনুযায়ী দ্রুত উইথড্র
-- wallets.beans = Beans × 100 (সেন্টি-Beans, ছোট গিফটও হারায় না)
alter table wallets add column if not exists beans bigint not null default 0;
do $$ begin
  alter table wallets add constraint wallets_beans_check check (beans >= 0);
exception when duplicate_object then null; end $$;
alter table transactions drop constraint if exists transactions_bucket_check;
alter table transactions add constraint transactions_bucket_check check (bucket = any (array['coin','earning','pending','points','beans']));

insert into settings(key, value) values
 ('beans_enabled', 'true'::jsonb),
 ('coins_per_bean', '100'::jsonb),          -- ১০০ কয়েন = ১ Bean (১ লাখ কয়েন = ১০০০ Beans)
 ('bean_value_paisa', '100'::jsonb),        -- ১ Bean = ৳১ (এডমিন ১০০–১২০ পয়সা রাখবেন)
 ('beans_min_withdraw', '1000'::jsonb),     -- এর কম Beans টাকায় দেখাবে না
 ('withdraw_levels', '[{"refs":0,"days":7},{"refs":10,"days":3},{"refs":30,"days":2},{"refs":50,"days":1}]'::jsonb)
on conflict (key) do nothing;

create or replace function public._wallet_move(p_user uuid, p_bucket text, p_amount bigint, p_type text, p_ref_type text DEFAULT NULL::text, p_ref_id bigint DEFAULT NULL::bigint, p_note text DEFAULT NULL::text, p_idem text DEFAULT NULL::text, p_available_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_by uuid DEFAULT NULL::uuid)
 returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_after bigint; v_earned bigint := 0; v_gross numeric; v_cb bigint;
begin
  if p_amount = 0 then return null; end if;
  -- হোস্টের গিফট/কলের আয় → Beans (পার্সেন্ট নয়, মোট কয়েন ÷ coins_per_bean)
  if p_amount > 0 and p_bucket in ('pending', 'earning') and p_type in ('gift_received', 'call_earning')
     and coalesce(public.setting_text('beans_enabled'), 'false') = 'true'
     and (select account_type from profiles where id = p_user) = 'host' then
    v_gross := case p_ref_type
      when 'gift_tx' then (select total_coins from gift_transactions where id = p_ref_id)
      when 'call' then (select rate_coins from calls where id = p_ref_id) end;
    if v_gross is null then v_gross := p_amount::numeric / greatest(public.setting_int('coin_price_paisa'), 1); end if;
    v_cb := floor(v_gross * 100 / greatest(public.setting_int('coins_per_bean'), 1));
    if v_cb <= 0 then return null; end if;
    return public._wallet_move(p_user, 'beans', v_cb, p_type, p_ref_type, p_ref_id, p_note, p_idem, null, p_by);
  end if;
  if p_amount > 0 and public._income_locked(p_type) then
    if p_type = 'points_convert' then raise exception 'INCOME_LOCKED'; end if;
    return null;
  end if;
  if p_idem is not null and exists (select 1 from transactions where idem_key = p_idem) then return null; end if;
  insert into wallets (user_id) values (p_user) on conflict do nothing;
  if p_amount > 0 and p_type in ('view_earning','like_earning','comment_earning','gift_received','points_convert',
                                 'referral_bonus','referral_tier_bonus','post_like_earning','post_comment_earning',
                                 'post_share_earning','contest_prize','season_prize') then
    v_earned := p_amount;
  end if;
  if p_bucket = 'coin' then
    update wallets set coin_balance = coin_balance + p_amount, updated_at = now() where user_id = p_user returning coin_balance into v_after;
  elsif p_bucket = 'earning' then
    update wallets set earning_paisa = earning_paisa + p_amount, total_earned_paisa = total_earned_paisa + v_earned, updated_at = now()
      where user_id = p_user returning earning_paisa into v_after;
  elsif p_bucket = 'pending' then
    update wallets set pending_paisa = pending_paisa + p_amount, total_earned_paisa = total_earned_paisa + v_earned, updated_at = now()
      where user_id = p_user returning pending_paisa into v_after;
  elsif p_bucket = 'points' then
    update wallets set points = points + p_amount, updated_at = now() where user_id = p_user returning points into v_after;
  elsif p_bucket = 'beans' then
    update wallets set beans = beans + p_amount, updated_at = now() where user_id = p_user returning beans into v_after;
  else
    raise exception 'BAD_BUCKET';
  end if;
  insert into transactions (user_id, type, bucket, amount, balance_after, ref_type, ref_id, note, idem_key, available_at, created_by)
  values (p_user, p_type, p_bucket, p_amount, v_after, p_ref_type, p_ref_id, p_note, p_idem, p_available_at, p_by);
  if p_bucket = 'coin' then
    if p_amount > 0 and p_type in ('cash_in', 'play_purchase', 'seller_buy') then
      update profiles set wealth_topup = wealth_topup + p_amount where id = p_user;
    elsif p_amount < 0 and p_type not in ('seller_sale', 'seller_commission', 'admin_adjust', 'admin_coin_grant') then
      update profiles set wealth_spent = wealth_spent - p_amount where id = p_user;
    end if;
    if p_amount > 0 and p_type in ('cash_in', 'play_purchase') then
      perform public._ref_topup_bonus(p_user, p_amount, coalesce(p_idem, p_type || ':' || coalesce(p_ref_id::text, '')));
    end if;
  end if;
  return v_after;
end $function$;

-- Beans থেকে কত টাকা তোলা যায় (১০০০ Beans-এর কম হলে ০)
create or replace function public._beans_usable_paisa(p_user uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select case when coalesce(w.beans, 0) >= public.setting_int('beans_min_withdraw') * 100
    then floor(w.beans * public.setting_int('bean_value_paisa') / 100.0)::bigint else 0 end
  from wallets w where w.user_id = p_user;
$$;

-- সফল রেফার অনুযায়ী উইথড্রর অপেক্ষা (দিন)
create or replace function public._withdraw_level(p_user uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare n int; lv jsonb; cur jsonb := null; nxt jsonb := null; x jsonb;
begin
  select count(*) into n from profiles where referred_by = p_user and referral_qualified_at is not null;
  select value into lv from settings where key = 'withdraw_levels';
  if lv is null or jsonb_typeof(lv) <> 'array' or jsonb_array_length(lv) = 0 then
    lv := jsonb_build_array(jsonb_build_object('refs', 0, 'days', public.setting_int('withdraw_cooldown_days')));
  end if;
  for x in select e from jsonb_array_elements(lv) e order by (e->>'refs')::int loop
    if (x->>'refs')::int <= n then cur := x; elsif nxt is null then nxt := x; end if;
  end loop;
  if cur is null then cur := jsonb_build_object('refs', 0, 'days', public.setting_int('withdraw_cooldown_days')); end if;
  return json_build_object('refs', n, 'days', (cur->>'days')::numeric, 'next', nxt, 'levels', lv);
end $$;

create or replace function public.request_withdraw(p_amount_paisa bigint, p_method text, p_account text, p_name text)
 returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare u uuid := public._active_user(); w record; last_at timestamptz; next_at timestamptz;
        fee bigint; r_id bigint; days numeric; usable bigint; need bigint; cb bigint;
begin
  if p_method not in ('bkash','nagad','rocket') then raise exception 'BAD_METHOD'; end if;
  if p_account !~ '^01[3-9][0-9]{8}$' then raise exception 'BAD_NUMBER'; end if;
  select * into w from wallets where user_id = u for update;
  if w.is_frozen then raise exception 'WALLET_FROZEN'; end if;
  if (select created_at from profiles where id = u)
       > now() - make_interval(days => public.setting_int('min_account_age_days')::int) then
    raise exception 'ACCOUNT_TOO_NEW';
  end if;
  days := (public._withdraw_level(u)->>'days')::numeric;
  select max(created_at) into last_at from withdraw_requests where user_id = u and status <> 'rejected';
  if last_at is not null and days > 0 then
    next_at := last_at + make_interval(secs => (days * 86400)::double precision);
    if next_at > now() then
      raise exception 'WITHDRAW_COOLDOWN:%', to_char(next_at at time zone 'Asia/Dhaka', 'YYYY-MM-DD HH24:MI');
    end if;
  end if;
  if p_amount_paisa < public.setting_int('withdraw_min_paisa') then raise exception 'BELOW_MIN'; end if;
  usable := coalesce(public._beans_usable_paisa(u), 0);
  if p_amount_paisa > w.earning_paisa + usable then raise exception 'INSUFFICIENT_BALANCE'; end if;
  fee := floor(p_amount_paisa * public.setting_int('withdraw_fee_pct') / 100.0);
  begin
    insert into withdraw_requests (user_id, amount_paisa, fee_paisa, payable_paisa, method, account_number, account_name)
    values (u, p_amount_paisa, fee, p_amount_paisa - fee, p_method, p_account, nullif(trim(p_name), ''))
    returning id into r_id;
  exception when unique_violation then
    raise exception 'OPEN_REQUEST_EXISTS';
  end;
  -- ব্যালেন্সে কম থাকলে দরকারি Beans টাকায় বদলে নেওয়া
  if p_amount_paisa > w.earning_paisa then
    need := p_amount_paisa - w.earning_paisa;
    cb := least(w.beans, ceil(need * 100.0 / greatest(public.setting_int('bean_value_paisa'), 1))::bigint);
    perform public._wallet_move(u, 'beans', -cb, 'beans_convert', 'withdraw', r_id, 'Beans → ৳', 'bc-b:' || r_id);
    perform public._wallet_move(u, 'earning', need, 'beans_convert', 'withdraw', r_id, 'Beans → ৳', 'bc-e:' || r_id);
  end if;
  perform public._wallet_move(u, 'earning', -p_amount_paisa, 'withdraw_hold', 'withdraw', r_id,
                              p_method || ' ' || p_account, 'wd-hold:' || r_id);
  return r_id;
end $function$;

create or replace function public.my_beans()
returns json language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); w record;
begin
  if u is null then raise exception 'NOT_AUTH'; end if;
  select * into w from wallets where user_id = u;
  return json_build_object(
    'enabled', coalesce(public.setting_text('beans_enabled'), 'false') = 'true',
    'beans', floor(coalesce(w.beans, 0) / 100.0), 'earning_paisa', coalesce(w.earning_paisa, 0),
    'usable_paisa', coalesce(public._beans_usable_paisa(u), 0),
    'min_beans', public.setting_int('beans_min_withdraw'), 'bean_value_paisa', public.setting_int('bean_value_paisa'),
    'coins_per_bean', public.setting_int('coins_per_bean'), 'level', public._withdraw_level(u));
end $$;
revoke all on function public.my_beans() from public, anon;
grant execute on function public.my_beans() to authenticated;
revoke all on function public._beans_usable_paisa(uuid) from public, anon, authenticated;
revoke all on function public._withdraw_level(uuid) from public, anon, authenticated;
