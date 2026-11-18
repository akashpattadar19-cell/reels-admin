-- 017: watermarked downloads (APK burns logo + @username into the file) + counter
alter table videos add column if not exists downloads_count int not null default 0;
insert into settings (key, value, description, is_public) values
  ('downloads_enabled', 'true', 'ইউজাররা ভিডিও ডাউনলোড করতে পারবে (ওয়াটারমার্কসহ)', true),
  ('watermark_text', '"Reels Enjoy"', 'ডাউনলোড করা ভিডিওর ওয়াটারমার্কের লেখা', true)
on conflict (key) do nothing;
create or replace function public.record_download(p_video bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  update videos set downloads_count = downloads_count + 1 where id = p_video and status = 'published';
end $$;
revoke all on function public.record_download(bigint) from public, anon;
grant execute on function public.record_download(bigint) to authenticated;
