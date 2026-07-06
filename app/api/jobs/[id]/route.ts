import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/jobs/[id] — poll a background job's status/progress/result. RLS
// (jobs_owner_select, migration 024) enforces ownership at the DB level; the
// session client is used deliberately so that guarantee is actually exercised.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: job, error } = await supabase
    .from('jobs')
    .select('id, type, status, progress, result, error, created_at, updated_at')
    .eq('id', id)
    .single()
  if (error || !job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ job })
}
