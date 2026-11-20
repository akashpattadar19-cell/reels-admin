-- 057: প্রথম লগইনে ইউজার/হোস্ট বেছে নেওয়া + Me পেজের ব্যানার এডমিন থেকে
alter table profiles add column if not exists start_choice_done boolean not null default false;
update profiles set start_choice_done = true where created_at < now();

create or replace function public.choose_start_type(p_type text)
returns text language plpgsql security definer set search_path = public as $$
declare u uuid := public._active_user(); r text := 'user';
begin
  if p_type not in ('user', 'host') then raise exception 'BAD_TYPE'; end if;
  if p_type = 'host' then r := public.set_account_type('host'); end if;
  update profiles set start_choice_done = true where id = u;
  return r;
end $$;
revoke all on function public.choose_start_type(text) from public, anon;
grant execute on function public.choose_start_type(text) to authenticated;

insert into settings(key, value) values
 ('start_rules_user', to_jsonb('ভিডিও, ফটো ও লেখা দেখুন, লাইক-কমেন্ট করুন
পুরো ভিডিও দেখে পয়েন্ট জমান, বন্ধুদের রেফার করে আয় করুন
নিজের বানানো ভিডিও/ছবি পোস্ট করুন — অন্যের ভিডিও, লোগো বা ওয়াটারমার্ক নয়
প্রিমিয়াম ভিডিও কয়েন দিয়ে দেখবেন, হোস্টদের গিফট দিতে পারবেন
গালাগালি, অশ্লীল বা ভুয়া কিছু করলে অ্যাকাউন্ট জেলে বা ব্যান হবে'::text)),
 ('start_rules_user_en', to_jsonb('Watch videos, photos and text posts, like and comment
Earn points for full watches and earn by inviting friends
Post only your own videos/photos — no one else''s videos, logos or watermarks
Watch premium videos with coins and send gifts to hosts
Abuse, obscene or fake activity gets the account jailed or banned'::text)),
 ('start_rules_host', to_jsonb('লাইভ, পার্টি ও ভিডিও/অডিও কল করে গিফট ও কলের আয় পাবেন
প্রিমিয়াম ভিডিও দিতে পারবেন (শুধু নিজের বা অনুমতি থাকা কনটেন্ট)
নিজের আসল ছবি ও তথ্য দিতে হবে, ১৮ বছরের বেশি হতে হবে
লাইভ ও কলে অশ্লীল, অপ্রাপ্তবয়স্ক বা বেআইনি কিছু সম্পূর্ণ নিষিদ্ধ — ২৪ ঘণ্টা নজরদারি
হোস্ট আবেদন অ্যাডমিন যাচাই করে অনুমোদন দেবেন'::text)),
 ('start_rules_host_en', to_jsonb('Earn from gifts and calls by going live, hosting parties and taking video/audio calls
You can post premium videos (only your own or licensed content)
Use your real photo and details; you must be over 18
Obscene, underage or illegal content in live and calls is strictly banned — monitored 24 hours
The admin reviews and approves host applications'::text)),
 ('me_banners', '[]'::jsonb)
on conflict (key) do nothing;
