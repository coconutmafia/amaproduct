import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { action, projectId, data } = await request.json()

    if (action === 'create_warmup_plan') {
      const { data: plan, error } = await supabase
        .from('warmup_plans')
        .insert({ ...data, project_id: projectId })
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ planId: plan.id })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { action, contentItemId, bodyText } = await request.json()

    if (action === 'approve_content') {
      const { error } = await supabase
        .from('content_items')
        .update({ is_approved: true, body_text: bodyText })
        .eq('id', contentItemId)

      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
