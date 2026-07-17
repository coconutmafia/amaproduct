-- ===== MIGRATION 037: каскадное удаление профиля вместе с юзером =====
--
-- Проблема (поймана живьём 17 июля): profiles.id ссылается на auth.users(id) БЕЗ
-- ON DELETE CASCADE (миграция 001). Из-за этого удалить юзера НЕЛЬЗЯ: внешний ключ
-- держит его, пока существует профиль, и удаление молча падает. Проверено: при
-- удалении тестового auth-юзера профиль остался, а сам юзер — нет (рассинхрон
-- auth.users vs profiles). То же ждало бы и живого человека, который жмёт «удалить
-- аккаунт» (/api/account/delete).
--
-- Цепочка тоже была неполной: projects.owner_id → profiles(id) без ON DELETE, то есть
-- RESTRICT. Даже с каскадом на profiles удаление юзера С ПРОЕКТАМИ (то есть любого
-- реального) всё равно упиралось бы в проекты. Чиним всю цепочку:
--   auth.users → profiles → projects → (материалы/контент уже каскадятся от projects)
--
-- ЧТО НЕ ТРОГАЕМ намеренно:
--   • payments.user_id — ON DELETE SET NULL (031): запись об оплате обязана пережить
--     юзера, иначе поедет бухгалтерия;
--   • viral_reels.created_by / content_trends.created_by — SET NULL, общий контент
--     не должен исчезать вместе с автором.
--
-- Сирот в базе на момент миграции нет (проверено: 39 профилей = 39 auth-юзеров),
-- поэтому чистка не нужна — только исправление связей.
-- Идемпотентна: повторный прогон безопасен.

-- ── 1. profiles → auth.users: удалили юзера, удалился и профиль ──────────────
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.profiles'::regclass
     and confrelid = 'auth.users'::regclass
     and contype = 'f';
  if c is not null then
    execute format('alter table public.profiles drop constraint %I', c);
  end if;
end $$;

alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;

-- ── 2. projects → profiles: иначе каскад упрётся в проекты владельца ─────────
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.projects'::regclass
     and confrelid = 'public.profiles'::regclass
     and contype = 'f';
  if c is not null then
    execute format('alter table public.projects drop constraint %I', c);
  end if;
end $$;

alter table public.projects
  add constraint projects_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete cascade;

-- ── 3. project_members.invited_by: пригласивший не должен блокировать удаление ─
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.project_members'::regclass
     and confrelid = 'auth.users'::regclass
     and contype = 'f'
     and conname like '%invited_by%';
  if c is not null then
    execute format('alter table public.project_members drop constraint %I', c);
    execute 'alter table public.project_members
             add constraint project_members_invited_by_fkey
             foreign key (invited_by) references auth.users(id) on delete set null';
  end if;
end $$;
