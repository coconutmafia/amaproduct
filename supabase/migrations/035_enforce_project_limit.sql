-- ===== MIGRATION 035: лимит проектов по тарифу (серверный энфорс) =====
-- Аудит: лимиты «1 / 3 / 10 проектов» (PLAN_CONFIG) существовали ТОЛЬКО на витрине —
-- ни в API, ни в RLS, ни в триггерах их никто не проверял. Проект создаётся прямым
-- insert'ом с клиента (ProjectWizard), а RLS проверяет лишь owner_id = auth.uid().
-- Значит юзер на Соло (лимит 1) мог создать сколько угодно проектов — обход тарифа.
-- Плюс это множит расход Apify: квота «до 5 конкурентов» считается НА ПРОЕКТ, то есть
-- N проектов = 5×N платных скрейпов.
--
-- Почему триггером, а не в API: создание идёт клиентским insert'ом через PostgREST.
-- Проверка в роуте не закрыла бы прямой запрос с anon-ключом + JWT; триггер в БД
-- закрывает оба пути разом и не требует переписывать визард.
--
-- Лимиты синхронны с lib/generations-config.ts (PLAN_CONFIG[*].projects):
--   trial 3 | solo 1 | pro 3 | producer 10   (fallback 3)
-- Админы не ограничены. Существующие проекты не трогаются — триггер только на INSERT,
-- поэтому у кого уже больше лимита, всё останется, но новый создать не даст.
-- Идемпотентна: повторный прогон безопасен.

create or replace function project_limit(plan text)
returns integer
language plpgsql immutable
as $$
begin
  return case plan
    when 'trial'    then 3
    when 'solo'     then 1
    when 'pro'      then 3
    when 'producer' then 10
    else 3
  end;
end;
$$;

create or replace function enforce_project_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier  text;
  v_role  text;
  v_count integer;
  v_limit integer;
begin
  select subscription_tier, role into v_tier, v_role
    from profiles where id = new.owner_id;

  -- Профиля нет (гонка при регистрации) или админ — не ограничиваем.
  if not found or v_role = 'admin' then
    return new;
  end if;

  v_limit := project_limit(coalesce(v_tier, 'trial'));
  select count(*) into v_count from projects where owner_id = new.owner_id;

  if v_count >= v_limit then
    -- Текст ловится клиентом (lib/friendlyError.ts) и показывается по-человечески
    -- с предложением тарифа, а не сырым дампом.
    raise exception 'project_limit_reached: % of %', v_count, v_limit
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_enforce_limit on projects;
create trigger projects_enforce_limit
  before insert on projects
  for each row execute function enforce_project_limit();
