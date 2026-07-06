-- Background job queue (roadmap #8): long tasks (transcription first) run
-- server-side to completion via Next.js `after()` self-continuation, instead
-- of depending on the client holding a live loop of requests open. A phone
-- that locks/backgrounds mid-transcription no longer loses progress — the
-- job keeps running server-side; the client just polls status when it wakes.
create table if not exists jobs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  type       text not null,                                    -- 'transcribe' (more types later)
  status     text not null default 'queued'
             check (status in ('queued','processing','done','error')),
  payload    jsonb not null default '{}',                       -- job input (storagePath, ext, durationSec…)
  progress   jsonb not null default '{}',                       -- { doneChunks, totalChunks }
  result     jsonb,                                             -- { text } on success
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_project_idx on jobs (project_id, type, status, created_at desc);

alter table jobs enable row level security;
drop policy if exists jobs_owner_select on jobs;
create policy jobs_owner_select on jobs
  for select to authenticated
  using (user_id = auth.uid());
-- No insert/update/delete policy: only the service-role client (server routes,
-- after ownership is checked in app code) ever writes to this table.

create or replace function touch_jobs_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists jobs_touch on jobs;
create trigger jobs_touch
  before update on jobs
  for each row execute function touch_jobs_updated_at();
