import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProjectRole } from '@/lib/projects/access'

// GET — список сохранённых расшифровок интервью проекта (id, название, объём).
// Страница исследования показывает их чекбоксами, чтобы «Таблица исследования»
// собиралась по ВСЕМ кастдевам проекта, а не только по файлам текущей сессии
// (инцидент 01.09, Люба: 4 полных интервью лежали в материалах, таблица
// построилась по одному свежему обрывку). Тексты не отдаём — для анализа их
// по id достаёт сервер (POST /api/jobs/research-table { materialIds }).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const role = await getProjectRole(supabase, projectId, user.id)
  if (!role) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })

  const { data, error } = await supabase
    .from('project_materials')
    .select('id, title, created_at, raw_content')
    .eq('project_id', projectId)
    .eq('material_type', 'interview_transcript')
    .eq('processing_status', 'ready')
    .order('created_at', { ascending: true })
  if (error) {
    return NextResponse.json({ error: 'Не удалось загрузить расшифровки — обнови страницу' }, { status: 500 })
  }

  return NextResponse.json({
    transcripts: (data ?? []).map(m => ({
      id: m.id,
      title: m.title,
      createdAt: m.created_at,
      chars: String(m.raw_content ?? '').length,
    })),
  })
}
