import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { captureException } from '@/lib/sentry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Сохранённые оформления свободного редактора (миграция 048). Читаем/пишем
// сессионным клиентом — RLS отдаёт только свои. До миграции таблицы нет:
// отвечаем пустым списком с флагом, UI показывает подсказку, а не ошибку.
const missing = (msg?: string) => /story_layouts|does not exist|schema cache/i.test(msg || '')

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ layouts: [] })
  const { data, error } = await supabase
    .from('story_layouts')
    .select('id, title, format, design, preview_url, created_at, updated_at')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(60)
  if (error) {
    if (missing(error.message)) return NextResponse.json({ layouts: [], needsMigration: true })
    await captureException(new Error(error.message), { where: 'story-layouts GET' })
    return NextResponse.json({ error: 'Не удалось загрузить оформления — обнови страницу' }, { status: 500 })
  }
  return NextResponse.json({ layouts: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { id?: string; projectId?: string; title?: string; format?: string; design?: unknown; previewUrl?: string | null }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const title = String(body.title ?? '').trim().slice(0, 80)
  if (!body.projectId || !title || !body.design || typeof body.design !== 'object') {
    return NextResponse.json({ error: 'Нужны проект, название и раскладка' }, { status: 400 })
  }
  const row = {
    user_id: user.id, project_id: body.projectId, title,
    format: String(body.format || 'story').slice(0, 24), design: body.design,
    preview_url: body.previewUrl || null,
  }
  const q = body.id
    ? supabase.from('story_layouts').update(row).eq('id', body.id).select('id').single()
    : supabase.from('story_layouts').insert(row).select('id').single()
  const { data, error } = await q
  if (error) {
    if (missing(error.message)) return NextResponse.json({ error: 'Сохранение оформлений ещё не включено — нужна миграция 048' }, { status: 503 })
    await captureException(new Error(error.message), { where: 'story-layouts POST' })
    return NextResponse.json({ error: 'Не удалось сохранить оформление — попробуй ещё раз' }, { status: 500 })
  }
  return NextResponse.json({ id: data?.id })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('story_layouts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Не удалось удалить' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
