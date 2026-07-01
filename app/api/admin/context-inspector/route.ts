import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ALWAYS_INCLUDE, RAW_LIMIT, DEFAULT_RAW_LIMIT, isUsableMaterial } from '@/lib/ai/rag'

export const dynamic = 'force-dynamic'

// ── Context inspector ────────────────────────────────────────────────────────
// Proves, per project, which context layers actually reach the generation
// prompt — the core «многоуровневая система» / moat. Reuses rag.ts's exported
// constants so what it shows never drifts from what generation really uses.
//
// Access: admin (any project) OR the project owner (their own project) — so the
// live Этап-2 run under the producer's own account can inspect her projects.

async function requireAccess(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const admin = createAdminClient()
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile?.role === 'admin'

  const { data: project } = await admin
    .from('projects').select('id, name, owner_id').eq('id', projectId).single()
  if (!project) return { error: 'Project not found', status: 404 as const }
  if (!isAdmin && project.owner_id !== user.id) return { error: 'Forbidden', status: 403 as const }

  return { admin, project, isAdmin }
}

const ALWAYS = new Set<string>(ALWAYS_INCLUDE)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')?.trim()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const ctx = await requireAccess(projectId)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, project } = ctx

  // ── All project materials — the raw side of the chain ──────────────────────
  const { data: mats } = await admin
    .from('project_materials')
    .select('id, title, material_type, raw_content, processing_status, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  const materials = (mats ?? []).map(m => {
    const chars = (m.raw_content ?? '').toString().trim().length
    const inAlways = ALWAYS.has(m.material_type)
    const usable = isUsableMaterial(m.processing_status)
    const hasText = chars > 0
    const limit = RAW_LIMIT[m.material_type] ?? DEFAULT_RAW_LIMIT
    let reaches: 'always_include' | 'embedding_only' | 'blocked' | 'empty'
    let reason = ''
    if (!hasText) { reaches = 'empty'; reason = 'raw_content пустой' }
    else if (inAlways && usable) { reaches = 'always_include' }
    else if (inAlways && !usable) { reaches = 'blocked'; reason = `статус «${m.processing_status}» — плейсхолдер/ошибка, отфильтрован` }
    else { reaches = 'embedding_only'; reason = `material_type «${m.material_type}» не в ALWAYS_INCLUDE — доходит только при семантическом совпадении (эмбеддинг)` }
    return {
      id: m.id,
      title: m.title,
      material_type: m.material_type,
      processing_status: m.processing_status,
      chars,
      includedChars: reaches === 'always_include' ? Math.min(chars, limit) : 0,
      truncated: reaches === 'always_include' && chars > limit,
      reaches,
      reason,
      created_at: m.created_at,
    }
  })

  // ── Per ALWAYS_INCLUDE link: present & reaching? (the chain map for this project) ──
  const chainMap = ALWAYS_INCLUDE.map(type => {
    const rows = materials.filter(m => m.material_type === type)
    const reaching = rows.filter(r => r.reaches === 'always_include')
    return {
      material_type: type,
      present: rows.length > 0,
      rows: rows.length,
      reaching: reaching.length,
      totalChars: reaching.reduce((s, r) => s + r.includedChars, 0),
      note: rows.length === 0 ? 'нет материала'
        : reaching.length === 0 ? 'есть, но не доходит (пусто/блокировано)'
        : 'доходит до генерации',
    }
  })

  // ── Other layers ───────────────────────────────────────────────────────────
  const [{ count: chunkCount }, { count: styleCount }, { count: savedCount }, { count: sysCount }] = await Promise.all([
    admin.from('project_chunks').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
    admin.from('style_examples').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('is_active', true),
    admin.from('saved_content').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
    admin.from('knowledge_chunks').select('id', { count: 'exact', head: true }),
  ])

  const voiceRow = materials.find(m => m.material_type === 'voice_rules')

  const reachingMaterials = materials.filter(m => m.reaches === 'always_include')
  const blocked = materials.filter(m => m.reaches === 'blocked')
  const embeddingOnly = materials.filter(m => m.reaches === 'embedding_only')

  return NextResponse.json({
    project: { id: project.id, name: project.name },
    layers: {
      // 1. системная методология
      systemKnowledge: { knowledgeChunks: sysCount ?? 0 },
      // 2. материалы проекта (эмбеддинги, query-зависимо)
      projectEmbeddings: { chunks: chunkCount ?? 0, note: 'подтягиваются по семантическому совпадению с запросом' },
      // 3. ALWAYS_INCLUDE — сырьём, надёжно
      alwaysInclude: {
        chainMap,
        reachingCount: reachingMaterials.length,
        totalChars: reachingMaterials.reduce((s, m) => s + m.includedChars, 0),
      },
      // 4. голос
      style: { styleBank: styleCount ?? 0, savedContent: savedCount ?? 0 },
      // 5. правила голоса (верх промпта)
      voiceRules: { present: !!voiceRow, chars: voiceRow?.chars ?? 0 },
    },
    materials,
    warnings: {
      blocked: blocked.map(m => ({ title: m.title, material_type: m.material_type, reason: m.reason })),
      embeddingOnly: embeddingOnly.map(m => ({ title: m.title, material_type: m.material_type, reason: m.reason })),
      missingLinks: chainMap.filter(c => !c.present).map(c => c.material_type),
    },
  })
}
