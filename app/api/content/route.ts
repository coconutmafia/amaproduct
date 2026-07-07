import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isRlsError, READ_ONLY_MESSAGE } from '@/lib/projects/access'

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get('id')
    if (!itemId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    // Verify ownership via project
    const { data: item } = await supabase
      .from('content_items')
      .select('project_id, projects!inner(owner_id)')
      .eq('id', itemId)
      .single()

    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { error } = await supabase
      .from('content_items')
      .delete()
      .eq('id', itemId)

    if (error) {
      if (isRlsError(error)) return NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 403 })
      throw error
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
