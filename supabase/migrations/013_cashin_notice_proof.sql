-- 013: buy-coin notice (admin-editable) + optional payment screenshot proof (private bucket)
alter table cash_in_requests add column if not exists proof_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "proofs upload own" on storage.objects;
create policy "proofs upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "proofs read own or admin" on storage.objects;
create policy "proofs read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

insert into settings (key, value, description, is_public) values
  ('cashin_notice', to_jsonb('• শুধু উপরের নম্বরে Send Money করুন, Cash Out বা Payment নয়।
• টাকা পাঠানোর পর সঠিক TrxID দিন — ভুল বা ভুয়া TrxID দিলে অ্যাকাউন্ট ব্লক হবে।
• পেমেন্টের স্ক্রিনশট দিলে দ্রুত যাচাই হবে।
• সাধারণত ১–১২ ঘণ্টার মধ্যে কয়েন যোগ হয়।
• কেনা কয়েন শুধু গিফট ও প্রিমিয়ামে ব্যবহার করা যায়, টাকায় ফেরত নেওয়া যায় না।'::text),
   'কয়েন কেনার পেজের নোটিশ', true)
on conflict (key) do nothing;

create or replace function public.set_cash_in_proof(p_id bigint, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'NOT_LOGGED_IN'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> u::text then raise exception 'BAD_PATH'; end if;
  update cash_in_requests set proof_path = p_path where id = p_id and user_id = u and status = 'pending';
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;
revoke all on function public.set_cash_in_proof(bigint, text) from public, anon;
grant execute on function public.set_cash_in_proof(bigint, text) to authenticated;
