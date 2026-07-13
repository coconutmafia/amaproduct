-- ===== MIGRATION 031: payments ledger =====
-- A record of money received from users (subscription payments via Prodamus /
-- Stripe). Separate from `billing_events` (which is only webhook-idempotency:
-- provider event ids, no amounts). This is the queryable «who paid, when, how
-- much» ledger the admin/metabase needs — and the Excel export reads from here.
--
-- SAFE TO APPLY BEFORE PAYMENT IS LIVE: billing is dormant (BILLING_ENFORCED off,
-- no real payers), so this table starts empty. When Prodamus/Stripe go live, the
-- webhook handler inserts a row here per successful charge. Nothing reads/writes
-- it under RLS except the admin (service-role) client — same posture as
-- billing_events / error_events.
-- Idempotent: re-running is safe.

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,  -- keep the record if the user is deleted
  amount       numeric(12,2) not null,
  currency     text not null default 'RUB',
  status       text not null default 'succeeded'
               check (status in ('pending','succeeded','refunded','failed')),
  provider     text check (provider is null or provider in ('prodamus','stripe')),
  external_id  text,                        -- provider's payment/charge id (for reconciliation)
  description  text,                        -- e.g. tier + period ("Про · месяц")
  created_at   timestamptz not null default now()
);

create index if not exists payments_created_idx on payments (created_at desc);
create index if not exists payments_user_idx on payments (user_id);
-- One row per provider charge — a re-delivered webhook must not double-insert.
create unique index if not exists payments_provider_external_uniq
  on payments (provider, external_id)
  where external_id is not null;

alter table payments enable row level security;

-- Admins read; only the service-role client (webhook handler) ever inserts.
-- No user-facing policies — normal users can't see the ledger.
drop policy if exists payments_admin_read on payments;
create policy payments_admin_read on payments
  for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
