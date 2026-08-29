-- 041_diagnostic_leads.sql — заявки на консультацию из воронки диагностики
-- (спека ассистентки, 29.08: после отчёта форма имя/Telegram/Instagram,
-- «Заявка отправлена! Маркетолог команды Августа свяжется с вами в Telegram»).
--
-- Заявка — данные КОМАНДЫ, не клиента: пишет и читает только сервис-роль
-- (RLS включён, политик нет → anon/authenticated не видят таблицу вовсе).
-- Доставка в Telegram-чат заявок и amoCRM — флажки delivered_*: заявка
-- сохраняется ВСЕГДА, даже если внешняя доставка упала (лид не теряется).

create table if not exists diagnostic_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid references profiles(id) on delete set null,
  user_email    text,                          -- почта аккаунта на момент заявки
  name          text not null,
  telegram      text not null,
  instagram     text not null,
  source        text not null default 'diagnostic', -- метка «Заявка с диагностики»
  delivered_tg  boolean not null default false,
  delivered_amo boolean not null default false
);

create index if not exists diagnostic_leads_created_idx on diagnostic_leads (created_at desc);

alter table diagnostic_leads enable row level security;
-- Политик намеренно НЕТ: доступ только у service role.
