-- Storage bucket for uploaded project materials + knowledge-vault files.
-- It was created BY HAND in production and never captured in a migration, so a
-- fresh deploy (staging / re-provision) had no bucket → app/api/upload's
-- storage.upload failed and the file URL was silently dropped (the route
-- continues «главное текст»). This makes the bucket reproducible.
--
-- Public bucket: the app reads files via getPublicUrl (app/api/upload,
-- app/api/materials). Paths are `projects/{projectId}/{file}` or
-- `knowledge-vault/{file}`. Idempotent — in prod the existing bucket/policies
-- win (on conflict do nothing; drop-if-exists guards the policy names).
insert into storage.buckets (id, name, public, file_size_limit)
values ('materials', 'materials', true, 52428800) -- 50 MB
on conflict (id) do nothing;

-- Authenticated users can upload (the /api/upload route additionally enforces
-- project ownership at the app layer before writing).
drop policy if exists "materials_insert" on storage.objects;
create policy "materials_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'materials');

-- Authenticated users can remove files (materials cleanup on delete).
drop policy if exists "materials_delete" on storage.objects;
create policy "materials_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'materials');

-- Public read is served through the bucket's public endpoint (getPublicUrl);
-- no extra select policy is required for a public bucket.
