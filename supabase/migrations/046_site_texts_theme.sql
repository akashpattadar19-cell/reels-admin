-- 046: ওয়েবসাইটের লেখা ও ডিজাইন অ্যাডমিন থেকে (settings.site_texts jsonb, site_theme a|b|c); site_info()-এ যোগ
insert into settings (key, value, description) values ('site_texts', '{}', 'ওয়েবসাইটের লেখা (অ্যাডমিন → ওয়েবসাইট)'), ('site_theme', '"a"', 'ওয়েবসাইটের ডিজাইন a/b/c') on conflict (key) do nothing;
do $$
declare d text := pg_get_functiondef('public.site_info()'::regprocedure);
begin
  if position('site_texts' in d) > 0 then return; end if;
  d := replace(d, '''agent_enabled'', ''agent_ref_bonus_paisa''', '''site_texts'', ''site_theme'', ''agent_enabled'', ''agent_ref_bonus_paisa''');
  execute d;
end $$;
