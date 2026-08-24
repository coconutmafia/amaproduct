import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { processTranscribeJob } from '@/lib/jobs/runTranscribeJob'
import { processResearchTableJob } from '@/lib/jobs/runResearchTableJob'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300

// Internal-only: a job that ran out of time in one invocation schedules a
// fresh one here (self-fetch from lib/jobs/runTranscribeJob.ts), giving it a
// new full time budget. Same trusted-server-to-server pattern as the cron
// routes — reuses CRON_SECRET rather than asking the owner to set up yet
// another env var for what is, functionally, the same kind of internal call.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { jobId?: string }
  try { body = await request.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  if (!body.jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  // Диспетчеризация по типу джоба (24.08): раньше continue знал только
  // транскрибацию — теперь самопродолжаются и другие цепочные джобы.
  const admin = createAdminClient()
  const { data: job } = await admin.from('jobs').select('type').eq('id', body.jobId).single()
  const jobId = body.jobId as string
  if (job?.type === 'research_table1') after(() => processResearchTableJob(jobId))
  else after(() => processTranscribeJob(jobId))
  return NextResponse.json({ ok: true })
}
