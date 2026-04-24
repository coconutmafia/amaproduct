import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 10

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')
    if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

    const { data: job, error } = await supabase
      .from('warmup_jobs')
      .select('status, plan_data, error_msg')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      // Таблица не существует (migration не применена) — сообщаем явно
      const msg = error.message?.includes('does not exist')
        ? 'Таблица warmup_jobs не найдена. Примени миграцию 007 в Supabase SQL Editor.'
        : error.message
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({
      status: job.status,
      planData: job.plan_data ?? null,
      errorMsg: job.error_msg ?? null,
    })
  } catch (err) {
    console.error('Warmup status error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
