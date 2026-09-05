-- Временное расширение ресурса AI для конкретного клиента («открыть на N дней,
-- не больше» — просьба Матвея 04.09 про Дашу, которую закрыл кап при 29/300
-- единиц). Кап тарифа увеличивается на budget_boost_usd до budget_boost_until,
-- после даты расширение само перестаёт действовать — ничего выключать не надо.
alter table profiles
  add column if not exists budget_boost_usd numeric not null default 0,
  add column if not exists budget_boost_until timestamptz;
