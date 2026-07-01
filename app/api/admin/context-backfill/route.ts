import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedMaterialChunks } from '@/lib/ai/embed'

export const runtime = 'nodejs'
export const maxDuration = 300

// One-time backfill for a project created before the chain fixes:
//   1. Mirror products (products table) → 'product_description' materials so the
//      offer reaches generation (older projects saved products only in `products`).
//   2. Embed existing long materials (interview_transcript / audience_research /
//      meanings_map …) into project_chunks so their FULL text is retrievable —
//      forward fixes only embed NEW materials.
// Access: admin OR the project owner (so the owner can run it on their own data).

async function requireAccess(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const admin = createAdminClient()
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile?.role === 'admin'
  const { data: project } = await admin.from('projects').select('id, owner_id').eq('id', projectId).single()
  if (!project) return { error: 'Project not found', status: 404 as const }
  if (!isAdmin && project.owner_id !== user.id) return { error: 'Forbidden', status: 403 as const }
  return { admin }
}

// Material types whose full text is worth embedding for retrieval.
const EMBED_TYPES = ['interview_transcript', 'audience_research', 'meanings_map', 'audience_survey']

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')?.trim()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const ctx = await requireAccess(projectId)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin } = ctx

  const result = { productsMirrored: 0, materialsEmbedded: 0, chunksBefore: 0, chunksAfter: 0 }

  // ── 1. products → product_description materials (only if none exist yet) ────
  const { data: existingProd } = await admin
    .from('project_materials').select('id')
    .eq('project_id', projectId).eq('material_type', 'product_description').limit(1)

  if (!existingProd || existingProd.length === 0) {
    const { data: products } = await admin
      .from('products').select('name, product_type, price, currency, description, sales_page_url')
      .eq('project_id', projectId)
    for (const p of (products ?? [])) {
      if (!p.name) continue
      const raw = [
        `Продукт: ${p.name}`,
        p.product_type ? `Тип: ${p.product_type}` : '',
        p.price ? `Цена: ${p.price} ${p.currency ?? ''}`.trim() : '',
        p.description ? `Описание: ${p.description}` : '',
        p.sales_page_url ? `Страница продаж: ${p.sales_page_url}` : '',
      ].filter(Boolean).join('\n')
      const { error } = await admin.from('project_materials').insert({
        project_id: projectId, material_type: 'product_description',
        title: p.name, raw_content: raw, processing_status: 'ready',
      })
      if (!error) result.productsMirrored++
    }
  }

  // ── 2. embed long materials that have no chunks yet ────────────────────────
  const { count: before } = await admin
    .from('project_chunks').select('id', { count: 'exact', head: true }).eq('project_id', projectId)
  result.chunksBefore = before ?? 0

  const { data: mats } = await admin
    .from('project_materials').select('id, material_type, raw_content, processing_status')
    .eq('project_id', projectId).in('material_type', EMBED_TYPES)

  for (const m of (mats ?? [])) {
    const text = (m.raw_content ?? '').toString()
    if (text.trim().length < 40) continue
    if (m.processing_status === 'processing' || m.processing_status === 'error') continue
    const { count: has } = await admin
      .from('project_chunks').select('id', { count: 'exact', head: true }).eq('material_id', m.id)
    if ((has ?? 0) > 0) continue // already embedded
    await embedMaterialChunks(m.id, projectId, text)
    result.materialsEmbedded++
  }

  const { count: after } = await admin
    .from('project_chunks').select('id', { count: 'exact', head: true }).eq('project_id', projectId)
  result.chunksAfter = after ?? 0

  return NextResponse.json({ ok: true, ...result })
}
