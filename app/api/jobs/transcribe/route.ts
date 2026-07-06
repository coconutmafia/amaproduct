import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { processTranscribeJob } from '@/lib/jobs/runTranscribeJob'

// ffmpeg needs the Node runtime + the traced binary (see next.config).
export const runtime = 'nodejs'
export const maxDuration = 300

// Roadmap #8 — background transcription. The client uploads the audio file to
// Storage (unchanged) then calls this ONCE per file instead of looping chunk
// calls itself. Processing runs server-side via `after()`, self-continuing
// across invocations if a long interview needs more than one leg — so a
// locked/backgrounded phone no longer loses progress. The client just polls
// GET /api/jobs/[id] for status.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'transcribe')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  let body: { projectId?: string; storagePath?: string; ext?: string; durationSec?: number }
  try { body = await request.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { projectId, storagePath, ext, durationSec } = body
  if (!projectId || !storagePath) return NextResponse.json({ error: 'projectId и storagePath обязательны' }, { status: 400 })
  if (!storagePath.startsWith(`${user.id}/`)) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id: user.id,
    project_id: projectId,
    type: 'transcribe',
    status: 'queued',
    payload: { storagePath, ext: ext || 'mp3', durationSec: durationSec ?? null },
    progress: { doneChunks: 0, totalChunks: durationSec ? null : null },
  }).select('id').single()
  if (error || !job) return NextResponse.json({ error: error?.message ?? 'Не удалось создать задачу' }, { status: 500 })

  // Kick off the first leg AFTER the response is sent — the client gets the
  // jobId immediately and starts polling; this doesn't block that response.
  after(() => processTranscribeJob(job.id as string))

  return NextResponse.json({ jobId: job.id })
}
