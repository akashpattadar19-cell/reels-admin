-- 022: separate income rates for hosts. settings 'host_<key>' override '<key>' for account_type = 'host'.
create or replace function public._urate(p_user uuid, p_key text) returns bigint
language sql stable security definer set search_path = public as $$
  select case when (select account_type from profiles where id = p_user) = 'host'
                and exists (select 1 from settings where key = 'host_' || p_key)
              then public.setting_int('host_' || p_key) else public.setting_int(p_key) end;
$$;
create or replace function public._gift_pct(p_user uuid, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select case when (select account_type from profiles where id = p_user) = 'host'
                and public.setting_int('host_gift_creator_pct') > 0
              then least(public.setting_int('host_gift_creator_pct'), 100)::int else p_default end;
$$;
revoke all on function public._urate(uuid, text) from public, anon, authenticated;
revoke all on function public._gift_pct(uuid, int) from public, anon, authenticated;

insert into settings (key, value, description, is_public)
select 'host_' || key, value, 'হোস্ট: ' || coalesce(description, key), is_public from settings
where key in ('view_rate_paisa_per_1000','creator_daily_view_cap_paisa','like_rate_paisa','comment_rate_paisa',
              'post_like_rate_paisa','post_comment_rate_paisa','post_share_rate_paisa','post_daily_cap_paisa',
              'premium_creator_pct','referral_bonus_paisa')
on conflict (key) do nothing;
insert into settings (key, value, description, is_public) values
  ('host_gift_creator_pct', '0', 'হোস্ট: গিফটের কত % পাবে (০ = প্রতিটি গিফটের নিজস্ব %)', true)
on conflict (key) do nothing;

-- Earning functions patched in place (text replace of their current definitions):
--   credit_view_earnings: rate/cap per creator via _urate(r.user_id, ...)
--   _post_earn: _urate(p_owner, p_rate_key) and post_daily_cap_paisa
--   toggle_like / add_comment: _urate(v.user_id, 'like_rate_paisa' / 'comment_rate_paisa')
--   unlock_premium: _urate(v.user_id, 'premium_creator_pct')
--   _check_referral: _urate(p.referred_by, 'referral_bonus_paisa')
--   send_gift / send_post_gift: creator share = _gift_pct(receiver, g.creator_share_pct)
-- (applied as migration "host_income_rules" with a DO block doing replace() + EXECUTE on pg_get_functiondef)
