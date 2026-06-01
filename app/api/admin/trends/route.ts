import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return { supabase, user }
}

// GET — list all trends (admin)
export async function GET() {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await ctx.supabase
    .from('content_trends')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    if (error.message?.includes('does not exist')) {
      return NextResponse.json({ trends: [], needsMigration: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ trends: data || [] })
}

// POST — create a trend
export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json() as {
    title?: string; description?: string; example?: string
    format_type?: string; niches?: string[]
  }
  if (!body.title?.trim() || !body.description?.trim()) {
    return NextResponse.json({ error: 'Нужны название и описание' }, { status: 400 })
  }
  const fmt = ['any', 'post', 'reels', 'stories', 'carousel'].includes(body.format_type ?? '')
    ? body.format_type : 'any'

  const { data, error } = await ctx.supabase
    .from('content_trends')
    .insert({
      title:       body.title.trim(),
      description: body.description.trim(),
      example:     body.example?.trim() || null,
      format_type: fmt,
      niches:      (body.niches && body.niches.length > 0) ? body.niches : null,
      is_active:   true,
      created_by:  ctx.user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ trend: data })
}

// PATCH — update / toggle a trend
export async function PATCH(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json() as {
    id?: string; title?: string; description?: string; example?: string
    format_type?: string; niches?: string[]; is_active?: boolean
  }
  if (!body.id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.title !== undefined)       patch.title = body.title.trim()
  if (body.description !== undefined)  patch.description = body.description.trim()
  if (body.example !== undefined)      patch.example = body.example?.trim() || null
  if (body.format_type !== undefined)  patch.format_type = ['any','post','reels','stories','carousel'].includes(body.format_type) ? body.format_type : 'any'
  if (body.niches !== undefined)       patch.niches = (body.niches && body.niches.length > 0) ? body.niches : null
  if (body.is_active !== undefined)    patch.is_active = body.is_active

  const { data, error } = await ctx.supabase
    .from('content_trends')
    .update(patch)
    .eq('id', body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ trend: data })
}

// DELETE — remove a trend
export async function DELETE(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const { error } = await ctx.supabase.from('content_trends').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
