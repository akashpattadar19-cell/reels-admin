-- ইমেইল বা যেকোনো দেশের ফোন নম্বর দিয়ে লগইন
alter table public.user_private add column if not exists email text;
alter table public.user_private add column if not exists login_email text;
create unique index if not exists uq_user_private_email on public.user_private (lower(email)) where email is not null;
create unique index if not exists uq_user_private_login on public.user_private (login_email) where login_email is not null;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}');
        v_username text;
begin
  v_username := lower(coalesce(nullif(m->>'username',''), 'user' || substr(replace(new.id::text,'-',''),1,8)));
  insert into profiles (id, username, full_name) values (new.id, v_username, m->>'full_name');
  if m ? 'phone' then
    insert into user_private (user_id, phone, email, login_email)
    values (new.id, m->>'phone', nullif(lower(m->>'email'), ''), new.email);
  end if;
  insert into wallets (user_id) values (new.id);
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- 007: admin_users also searches user_private.email (see 004 for the full function)
