-- Storage bucket for uploaded project materials + knowledge-vault files.
-- It was created BY HAND in production and never captured in a migration, so a
-- fresh deploy (staging / re-provision) had no bucket → app/api/upload's
-- storage.upload failed and the file URL was silently dropped (the route
-- continues «главное текст»). This makes the bucket reproducible.
--
-- PRIVATE bucket (corrected 7 июля — see 025): this holds uploaded business/
-- client materials (audience research, interview transcripts, etc.), which can
-- be sensitive. A public bucket means anyone who ever sees a leaked/guessed
-- link can open the file forever, with no way to revoke it. The app now stores
-- the bare storage PATH (not a public URL) and mints a short-lived signed URL
-- on demand via GET /api/materials/[id]/file (ownership-checked). Idempotent —
-- in prod the existing bucket/policies win (on conflict do nothing;
-- drop-if-exists guards the policy names).
insert into storage.buckets (id, name, public, file_size_limit)
values ('materials', 'materials', false, 52428800) -- 50 MB
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

-- No SELECT policy: reads go through GET /api/materials/[id]/file, which
-- verifies project ownership at the app layer then signs the URL using the
-- service-role client (bypasses RLS by design, same pattern as
-- video/overlay's use of createSignedUrl on project-brand).
