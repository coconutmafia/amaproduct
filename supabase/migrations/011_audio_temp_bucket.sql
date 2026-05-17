-- Temporary bucket for audio uploads before transcription.
-- Files land here from the browser, the server fetches byte-ranges and
-- forwards them to Whisper, then the client removes the file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio-temp',
  'audio-temp',
  false,
  209715200, -- 200 MB
  array[
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
    'audio/wav', 'audio/ogg', 'audio/oga', 'audio/opus', 'audio/x-ogg',
    'audio/webm', 'audio/aac', 'audio/flac',
    'video/mp4', 'video/ogg',
    'application/ogg', 'application/octet-stream'
  ]
) on conflict (id) do nothing;

-- Users can upload to their own folder only
create policy "audio_temp_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audio-temp'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can read their own files (needed for signed-URL generation on client)
create policy "audio_temp_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'audio-temp'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete their own files (cleanup after transcription)
create policy "audio_temp_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'audio-temp'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
