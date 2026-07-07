-- In-app error log so the team (and the assistant, via /api/admin/errors) can
-- see recent server/job/cron failures directly, without depending on the
-- Sentry dashboard + manual forwarding. Sentry stays as the email-alert layer;
-- this is the queryable-by-us layer. Client-side errors are intentionally NOT
-- stored here (they live in Sentry) — this table is high-signal server failures.
create table if not exists error_events (
  id         uuid primary key default gen_random_uuid(),
  level      text not null default 'error',   -- 'error' | 'warning' | 'info'
  source     text,                            -- 'server' | 'job' | 'cron'
  route      text,                            -- request path / where it happened
  message    text not null,
  stack      text,
  context    jsonb,
  user_id    uuid,                            -- if known; NO foreign key — best-effort
                                              -- logging must never fail on a bad ref
  created_at timestamptz not null default now()
);

create index if not exists error_events_created_idx on error_events (created_at desc);

alter table error_events enable row level security;

-- Admins read; nobody writes via the session client (only the service-role
-- client, from lib/sentry.ts best-effort, ever inserts). Own-profile row is
-- always readable under RLS, so the admin check here is safe.
drop policy if exists error_events_admin_read on error_events;
create policy error_events_admin_read on error_events
  for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
