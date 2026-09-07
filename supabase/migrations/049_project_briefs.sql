-- «Память проекта» (07.09, цена чата): выжимка ВСЕХ материалов проекта на
-- ~15–20 тыс. токенов, которую чат/генерация читают вместо 150+ тыс. токенов
-- сырья на каждом сообщении. Пересобирается фоновым джобом project_brief, когда
-- материалы меняются (source_hash). Одна строка на проект. Читает сервис-роль
-- (доступ к проекту проверяет роут); владельцу — только чтение.
create table if not exists project_briefs (
  project_id  uuid primary key references projects(id) on delete cascade,
  brief       text not null,
  source_hash text not null,
  input_chars integer not null default 0,
  tokens      integer not null default 0,
  model       text,
  status      text not null default 'ready' check (status in ('ready', 'error')),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table project_briefs enable row level security;
drop policy if exists project_briefs_owner_read on project_briefs;
create policy project_briefs_owner_read on project_briefs
  for select to authenticated
  using (exists (select 1 from projects p where p.id = project_briefs.project_id and p.owner_id = auth.uid()));

create or replace function touch_project_briefs_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists project_briefs_touch on project_briefs;
create trigger project_briefs_touch
  before update on project_briefs
  for each row execute function touch_project_briefs_updated_at();
