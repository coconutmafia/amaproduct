-- Единицы и кап считаются по БИЛЛИНГОВОМУ периоду (месяц от оплаты), а не по
-- календарному месяцу (мандат Матвея 06.09). Вебхуки при новой оплате обнуляют
-- счётчики и ставят generations_reset_at = дата следующего списания
-- (lib/billing/period.ts); здесь — колонка начала периода для капа и ленивый
-- сброс в RPC, который у платящих равняется на current_period_end.
alter table profiles add column if not exists period_started_at timestamptz;

CREATE OR REPLACE FUNCTION consume_generation(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile        RECORD;
  v_monthly_limit  INTEGER;
  v_now            TIMESTAMPTZ := NOW();
  v_next_reset     TIMESTAMPTZ;
BEGIN
  SELECT subscription_tier, generations_used, bonus_generations, generations_reset_at, current_period_end
  INTO v_profile
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Ленивый сброс: у платящего следующий сброс = конец оплаченного периода,
  -- у остальных — календарный месяц (как раньше).
  IF v_now >= v_profile.generations_reset_at THEN
    IF v_profile.current_period_end IS NOT NULL AND v_profile.current_period_end > v_now THEN
      v_next_reset := v_profile.current_period_end;
    ELSE
      v_next_reset := date_trunc('month', v_now) + INTERVAL '1 month';
    END IF;
    UPDATE profiles SET
      generations_used = 0,
      micro_actions_count = 0,
      generations_reset_at = v_next_reset,
      period_started_at = v_now
    WHERE id = p_user_id;
    v_profile.generations_used := 0;
  END IF;

  v_monthly_limit := generation_limit(v_profile.subscription_tier);

  IF v_profile.generations_used < v_monthly_limit THEN
    UPDATE profiles SET generations_used = generations_used + 1 WHERE id = p_user_id;
    RETURN TRUE;
  END IF;

  IF v_profile.bonus_generations > 0 THEN
    UPDATE profiles SET bonus_generations = bonus_generations - 1 WHERE id = p_user_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;
revoke execute on function consume_generation(uuid) from public, anon, authenticated;
grant  execute on function consume_generation(uuid) to service_role;
