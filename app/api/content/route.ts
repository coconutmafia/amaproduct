import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
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

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
