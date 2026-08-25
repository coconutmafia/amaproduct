-- ===== MIGRATION 039: учёт AI-расходов + микро-метеринг мелких действий =====
-- Решение Матвея 25.08: «математика должна быть плюсовой».
--
-- (1) ai_usage — журнал реальных расходов на провайдеров (Claude/Whisper/
--     gpt-image-1/Apify): роут × юзер × модель × токены. До этого расход был
--     слепой зоной: юниты никто не выбирал (топ 51/300), а деньги уходили в
--     немереные пути. Пишет ТОЛЬКО сервис-роль (fail-open: упавший лог никогда
--     не ломает генерацию). Клиентам таблица не видна вообще.
--
-- (2) Микро-метеринг: мелкие AI-действия (сообщение ассистенту, правка,
--     подсказки, голосовой ввод) стоят 1/10 юнита — каждое 10-е действие
--     списывает 1 юнит через consume_generation (та же ленивая месячная
--     механика, бонусы, аудит). При полностью исчерпанном лимите блокируется
--     КАЖДОЕ действие (не только десятое), иначе 9 из 10 были бы бесплатными.
--     Админы не считаются (как в consume_generation).
--
-- Идемпотентна: повторный прогон безопасен.

-- ── (1) журнал расходов ──────────────────────────────────────────────────────
create table if not exists ai_usage (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid,               -- null для кронов/standalone-лидмагнита
  route         text not null,      -- откуда вызвано (короткий путь/бакет)
  provider      text not null,      -- anthropic | openai_whisper | openai_image | apify
  model         text,
  input_tokens  integer,
  output_tokens integer,
  meta          jsonb
);
create index if not exists ai_usage_created_idx on ai_usage (created_at desc);
create index if not exists ai_usage_user_idx    on ai_usage (user_id, created_at desc);
create index if not exists ai_usage_route_idx   on ai_usage (route, created_at desc);

alter table ai_usage enable row level security;
-- Политик нет намеренно: только service_role (обходит RLS) пишет и читает.
revoke all on table ai_usage from anon, authenticated;

-- ── (2) микро-счётчик ────────────────────────────────────────────────────────
alter table profiles add column if not exists micro_actions_count integer not null default 0;

create or replace function consume_micro_action(p_user_id uuid, p_batch integer default 10)
returns boolean
language plpgsql
security definer
as $$
declare
  v_profile RECORD;
  v_used    integer;
  v_count   integer;
  v_now     timestamptz := now();
  v_allowed boolean;
begin
  -- FOR UPDATE сериализует конкурентные действия одного юзера (вкладки/даблклик)
  select role, subscription_tier, generations_used, bonus_generations,
         generations_reset_at
  into v_profile
  from profiles where id = p_user_id for update;

  if not found then return true; end if;          -- нет профиля — не блокируем
  if v_profile.role = 'admin' then return true; end if;

  -- Эффективный счётчик с учётом ленивого месячного сброса (как consume_generation)
  v_used := case when v_now >= v_profile.generations_reset_at then 0
                 else v_profile.generations_used end;

  -- Лимит полностью исчерпан → блокируем КАЖДОЕ мелкое действие
  if v_used >= generation_limit(v_profile.subscription_tier)
     and v_profile.bonus_generations <= 0 then
    return false;
  end if;

  update profiles set micro_actions_count = micro_actions_count + 1
    where id = p_user_id
    returning micro_actions_count into v_count;

  -- Каждое p_batch-е действие оплачивает юнит за всю пачку
  if v_count % greatest(p_batch, 1) = 0 then
    select consume_generation(p_user_id) into v_allowed;
    return coalesce(v_allowed, true);
  end if;
  return true;
end;
$$;

-- Как и consume_generation (миграция 032): клиенту напрямую звать нельзя —
-- только сервис-роль из серверного кода (иначе можно жечь чужой счётчик).
revoke execute on function consume_micro_action(uuid, integer) from anon, authenticated;
