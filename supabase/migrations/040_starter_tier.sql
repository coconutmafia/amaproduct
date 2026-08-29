-- 040_starter_tier.sql — тариф «Старт» (нижняя ступень воронки, 29.08).
--
-- Цена $25 / 2500₽, 100 юнитов, 1 проект. Числа посчитаны от себестоимости
-- (отчёт 29.08): полный базовый путь юзера ≈ 75 юнитов / $8-9 себестоимости,
-- 100 юнитов за $25 держат маржу ≥50% даже в стрессе «весь лимит чатом».
--
-- ПОРЯДОК ВКЛЮЧЕНИЯ (правило «обе платёжки одинаково» из МОДЕЛИ БИЛЛИНГА):
--   1) применить эту миграцию;
--   2) создать в ЛК Продамуса подписку «Старт» на 2500₽ (демо-период — как
--      решит Матвей; в Stripe у Старта триала НЕТ) и задать env
--      PRODAMUS_LINK_STARTER / PRODAMUS_SUB_STARTER;
--   3) включить витрину: NEXT_PUBLIC_STARTER_TIER=1 (Vercel) + redeploy.
-- Stripe-цену создавать не нужно: ensurePrice создаст её по lookup_key
-- ama_starter_monthly при первом чекауте.
--
-- Лимиты обязаны совпадать с PLAN_CONFIG (lib/generations-config.ts) — страж
-- tier-limits-sync сверяет три места: этот файл, конфиг и пробник limit-smoke.

-- 1. Разрешить значение 'starter' в profiles.subscription_tier
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('trial', 'starter', 'solo', 'pro', 'producer'));

-- 2. Месячный лимит юнитов (читает consume_generation) — тело 016 + starter
CREATE OR REPLACE FUNCTION generation_limit(plan TEXT)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN CASE plan
    WHEN 'trial'    THEN 300
    WHEN 'starter'  THEN 100
    WHEN 'solo'     THEN 300
    WHEN 'pro'      THEN 2000   -- fair-use ceiling
    WHEN 'producer' THEN 8000   -- fair-use ceiling
    ELSE 300
  END;
END;
$$;

-- 3. Лимит проектов (читает триггер enforce_project_limit) — тело 035 + starter
create or replace function project_limit(plan text)
returns integer
language plpgsql immutable
as $$
begin
  return case plan
    when 'trial'    then 3
    when 'starter'  then 1
    when 'solo'     then 1
    when 'pro'      then 3
    when 'producer' then 10
    else 3
  end;
end;
$$;
