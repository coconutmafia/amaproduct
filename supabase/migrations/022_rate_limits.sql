-- Per-user rate limiting for expensive endpoints (Claude / Apify / Whisper /
-- gpt-image-1). While BILLING_ENFORCED is off nothing capped these — one abusive
-- trial account could burn hundreds of $ of API overnight. This is a wallet
-- safety net independent of billing quotas.
--
-- Fixed-window counters: one row per (user, bucket, window_start). The RPC is
-- atomic (INSERT ... ON CONFLICT ... RETURNING), SECURITY DEFINER so it works
-- from the user-session client while the table itself stays locked down (RLS
-- enabled, no policies → no direct client access).

create table if not exists rate_limits (
  user_id      uuid not null,
  bucket       text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (user_id, bucket, window_start)
);

alter table rate_limits enable row level security;
-- no policies on purpose: only the SECURITY DEFINER function touches this table

create or replace function check_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit int,
  p_window_seconds int
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  w_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  cur int;
begin
  insert into rate_limits (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, w_start, 1)
  on conflict (user_id, bucket, window_start)
  do update set count = rate_limits.count + 1
  returning count into cur;
  return cur <= p_limit;
end; $$;

revoke all on function check_rate_limit(uuid, text, int, int) from public;
grant execute on function check_rate_limit(uuid, text, int, int) to authenticated;
grant execute on function check_rate_limit(uuid, text, int, int) to service_role;

-- Old windows are cleaned up by the daily chain-watch cron (delete < now()-2d).
