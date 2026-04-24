-- Таблица для асинхронной генерации планов прогрева (polling-архитектура)
-- Решает проблему таймаута Safari на iOS при длинных SSE-соединениях

create table if not exists warmup_jobs (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  status      text        not null default 'pending'
                          check (status in ('pending', 'done', 'error')),
  plan_data   jsonb,
  error_msg   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Автоматически обновляем updated_at
create or replace function update_warmup_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger warmup_jobs_updated_at
  before update on warmup_jobs
  for each row execute function update_warmup_jobs_updated_at();

-- RLS — каждый видит только свои задачи
alter table warmup_jobs enable row level security;

create policy "users see own warmup jobs"
  on warmup_jobs for select
  using (auth.uid() = user_id);

create policy "users insert own warmup jobs"
  on warmup_jobs for insert
  with check (auth.uid() = user_id);

-- Индекс для быстрого поиска по статусу
create index if not exists warmup_jobs_user_status_idx
  on warmup_jobs (user_id, status, created_at desc);

-- Чистим старые задачи (старше 24 часов) — не накапливаем мусор
-- (Можно запускать периодически через pg_cron или Supabase scheduled functions)
