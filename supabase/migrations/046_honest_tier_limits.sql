-- Честные объёмы Про/Продюсер (05.09): «безлимит (fair use)» обещал больше,
-- чем даёт кап себестоимости (40% цены). Объём = кап / $0.065:
-- pro $60 → 900, producer $120 → 1800. Синхронно с PLAN_CONFIG (страж
-- tier-limits-sync). project_limit и constraint остаются из 040.
CREATE OR REPLACE FUNCTION generation_limit(plan TEXT)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN CASE plan
    WHEN 'trial'    THEN 300
    WHEN 'starter'  THEN 100
    WHEN 'solo'     THEN 300
    WHEN 'pro'      THEN 900
    WHEN 'producer' THEN 1800
    ELSE 300
  END;
END;
$$;
