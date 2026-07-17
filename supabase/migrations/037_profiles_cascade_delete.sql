-- ===== MIGRATION 037: каскадное удаление профиля вместе с юзером =====
--
-- Проблема (поймана живьём 17 июля): profiles.id ссылается на auth.users(id) БЕЗ
-- ON DELETE CASCADE (миграция 001, строка 6: `id UUID REFERENCES auth.users(id)`),
-- то есть NO ACTION. Из-за этого удалить юзера НЕЛЬЗЯ: пока существует профиль,
-- внешний ключ отбивает удаление — Postgres кидает FK violation, GoTrue возвращает
-- ошибку, и /api/account/delete отдаёт человеку 500. Живой человек, нажавший
-- «удалить аккаунт», получает ошибку и остаётся в базе.
--
-- ⚠️ РАНЕЕ ЗДЕСЬ БЫЛО НАПИСАНО, что «юзер удалился, а профиль остался (рассинхрон
-- auth.users vs profiles)» — ЭТО НЕВЕРНО, и так быть не может: FK работает как
-- RESTRICT, поэтому не удаляется НИЧЕГО (ни юзер, ни профиль). Проверено фактом
-- 17 июля read-only по проду: 40 auth-юзеров = 40 профилей, сирот НЕТ ни в одну
-- сторону. Не тащи «рассинхрон» дальше — его не существует.
--
-- Цепочка тоже была неполной: projects.owner_id → profiles(id) без ON DELETE, то есть
-- RESTRICT. Даже с каскадом на profiles удаление юзера С ПРОЕКТАМИ (то есть любого
-- реального) всё равно упиралось бы в проекты. Чиним цепочку:
--   auth.users → profiles → projects → (материалы/контент уже каскадятся от projects)
--   + промокоды и рефералы (иначе каскад упрётся в них, см. ниже)
--
-- ПОЧЕМУ ГДЕ-ТО CASCADE, А ГДЕ-ТО SET NULL — решает NOT NULL, а не вкус:
-- у payments.user_id (031) SET NULL возможен потому, что колонка nullable. У
-- promo_code_uses.user_id и referrals.referrer_id/referred_id стоит NOT NULL —
-- там SET NULL упёрся бы в NOT NULL и удаление всё равно бы падало. Поэтому CASCADE.
-- Хочешь поменять на SET NULL — сначала сними NOT NULL, иначе будет тот же баг.
--
-- ЧТО НЕ ТРОГАЕМ намеренно:
--   • payments.user_id — ON DELETE SET NULL (031): запись об оплате обязана пережить
--     юзера, иначе поедет бухгалтерия;
--   • viral_reels.created_by / content_trends.created_by — SET NULL, общий контент
--     не должен исчезать вместе с автором;
--   • 🔴 knowledge_vault.admin_id — ОСТАЁТСЯ RESTRICT, И ЭТО НАРОЧНО. На проде там
--     42 записи методологии, все на одном админе. CASCADE здесь означал бы: удалил
--     аккаунт админа → стёр всю методологию, то есть главный актив продукта, который
--     закрывали миграцией 036. Пусть лучше удаление админа отбивается с ошибкой.
--     Следствие: удалить аккаунт админа по-прежнему нельзя — это осознанный размен.
--
-- Сирот в базе на момент миграции нет (проверено 17 июля: 40 профилей = 40
-- auth-юзеров), поэтому чистка не нужна — только исправление связей.
-- Блокирующие таблицы на момент миграции ПУСТЫ (referrals 0, promo_code_uses 0,
-- promo_codes.created_by 0 non-null, profiles.referred_by 0 non-null) — правки
-- ниже профилактические, ложатся без риска и без переписывания данных.
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

-- ── 4. Остальные ссылки на profiles(id) ─────────────────────────────────────
-- Без этого блока каскад из п.1 упрётся в первую же строку промокода/реферала и
-- удаление снова начнёт падать с FK violation — ровно тем же багом, что чиним.
-- Сейчас таблицы пустые, поэтому правка профилактическая: она нужна к моменту,
-- когда вернётся реф-механизм и промокоды начнут активировать.
--
-- Хелпер: пересоздать FK <таблица>.<колонка> → profiles(id) с нужным ON DELETE.
-- Пропускает несуществующие таблицы/колонки (часть схемы могла не доехать).
do $$
declare
  t   text;
  col text;
  act text;
  c   text;
  specs text[][] := array[
    -- таблица,            колонка,       ON DELETE
    ['promo_code_uses',    'user_id',     'cascade'],   -- NOT NULL → set null нельзя
    ['referrals',          'referrer_id', 'cascade'],   -- NOT NULL
    ['referrals',          'referred_id', 'cascade'],   -- NOT NULL
    ['promo_codes',        'created_by',  'set null'],  -- nullable: код переживает админа
    ['profiles',           'referred_by', 'set null']   -- nullable: ссылка на пригласителя
  ];
begin
  for i in 1 .. array_length(specs, 1) loop
    t   := specs[i][1];
    col := specs[i][2];
    act := specs[i][3];

    -- таблицы/колонки может не быть — тогда молча пропускаем
    if to_regclass('public.' || t) is null then
      raise notice '037: пропущена %.% — таблицы нет', t, col;
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = col
    ) then
      raise notice '037: пропущена %.% — колонки нет', t, col;
      continue;
    end if;

    -- снять существующий FK именно по этой колонке
    select con.conname into c
      from pg_constraint con
      join pg_attribute a
        on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.conrelid = ('public.' || t)::regclass
       and con.confrelid = 'public.profiles'::regclass
       and con.contype = 'f'
       and array_length(con.conkey, 1) = 1
       and a.attname = col;
    if c is not null then
      execute format('alter table public.%I drop constraint %I', t, c);
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I)
         references public.profiles(id) on delete %s',
      t, t || '_' || col || '_fkey', col, act
    );
    raise notice '037: %.% → on delete %', t, col, act;
  end loop;
end $$;
