-- Learning-loop metrics for «Готовое» (saved_content).
--
-- The results loop existed only for content-plan items (content_items.reach/…),
-- so chat-saved «Готовое» — the main library the RAG voice-learning feeds on —
-- had nowhere to record performance and was picked by recency alone. These
-- columns let the user enter reach/reactions/saves for saved content too; the
-- RAG then prefers what actually performed (see lib/ai/rag.ts).
--
-- saved_content itself predates the migrations folder (tech-debt, created by
-- hand — like the materials bucket): create-if-not-exists makes fresh envs
-- reproducible; on prod the existing table wins and only the ALTERs apply.
create table if not exists saved_content (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_id   uuid references projects(id) on delete cascade,
  content_type text,
  title        text,
  body         text not null,
  created_at   timestamptz not null default now()
);

alter table saved_content enable row level security;
drop policy if exists saved_content_owner on saved_content;
create policy saved_content_owner on saved_content
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table saved_content add column if not exists reach        int;
alter table saved_content add column if not exists reactions    int;
alter table saved_content add column if not exists saves        int;
alter table saved_content add column if not exists published_at timestamptz;
