-- Лента списаний единиц контента (мандат Матвея 04.09: «каждая задача,
-- которая списывает, должна фиксироваться у пользователя в интерфейсе»).
-- Пишет сервис-роль из гейтов (lib/generations, lib/ai/usage) и возвратов;
-- читает владелец свои строки (RLS) через /api/account/usage.
create table if not exists unit_ledger (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  action      text not null,               -- ключ действия: chat, content, transcribe, …
  units       numeric(8,2) not null,       -- + списание, − возврат; микро-действия дробные (0.5 / 0.1)
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_unit_ledger_user_created on unit_ledger(user_id, created_at desc);
alter table unit_ledger enable row level security;
drop policy if exists "unit_ledger_owner_read" on unit_ledger;
create policy "unit_ledger_owner_read" on unit_ledger for select using (auth.uid() = user_id);
