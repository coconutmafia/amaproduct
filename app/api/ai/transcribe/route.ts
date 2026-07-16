import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse }       from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { transcribeWindow } from '@/lib/jobs/transcribeWindow'

// ffmpeg needs the Node runtime + the binary (traced in next.config).
export const runtime     = 'nodejs'
export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// Legacy client-orchestrated per-chunk endpoint. Kept for compatibility; the
// research page now uses the background job flow (POST /api/jobs/transcribe)
// which reuses the SAME lib/jobs/transcribeWindow.ts logic — this route is a
// thin wrapper over it so behavior can't drift between the two paths.
export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'transcribe')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  let body: { storagePath?: string; startSec?: number; durSec?: number; ext?: string; isLastChunk?: boolean }
  try { body = await request.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { storagePath, startSec, durSec, ext: rawExt, isLastChunk } = body
  if (!storagePath) return NextResponse.json({ error: 'storagePath обязателен' }, { status: 400 })
  if (!storagePath.startsWith(`${user.id}/`)) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const ext = ((rawExt ?? storagePath.split('.').pop() ?? 'mp3').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'mp3'
  const admin = createAdminClient()

  const res = await transcribeWindow({
    admin, storagePath, ext, apiKey,
    startSec: typeof startSec === 'number' && startSec > 0 ? startSec : 0,
    durSec: typeof durSec === 'number' && durSec > 0 ? durSec : 0,
  })

  // Cleanup on the LAST chunk regardless of outcome (success, ended, or
  // error) — previously this only ran on success/ended, orphaning the temp
  // file in Storage whenever ffmpeg/Whisper failed on the final chunk.
  if (isLastChunk) await admin.storage.from('audio-temp').remove([storagePath]).catch(() => {})

  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status ?? 500 })
  if (res.ended) return NextResponse.json({ text: '', ended: true })
  return NextResponse.json({ text: res.text ?? '' })
}
