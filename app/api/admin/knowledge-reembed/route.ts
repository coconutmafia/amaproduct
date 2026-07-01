import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { splitIntoChunks } from '@/lib/ai/rag'

export const runtime = 'nodejs'
export const maxDuration = 300

// Re-chunk + re-embed the system knowledge vault into knowledge_chunks.
// Needed because knowledge_chunks had no INSERT policy (fixed in migration 021),
// so every prior admin upload wrote 0 chunks → the methodology never reached
// generation. This backfills the already-uploaded vault. Uses the service-role
// admin client for writes so it works regardless of RLS. Admin-gated.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden (admin only)' }, { status: 403 })

  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'OPENAI_API_KEY missing' }, { status: 503 })

  const admin = createAdminClient()
  const { data: items } = await admin
    .from('knowledge_vault')
    .select('id, title, raw_content')

  const result = { vaultItems: (items ?? []).length, embedded: 0, chunksWritten: 0, chunksBefore: 0, chunksAfter: 0, failed: [] as string[] }

  const { count: before } = await admin.from('knowledge_chunks').select('id', { count: 'exact', head: true })
  result.chunksBefore = before ?? 0

  for (const it of (items ?? [])) {
    const text = (it.raw_content ?? '').toString()
    if (text.trim().length < 40) continue
    try {
      // Idempotent: clear this item's prior chunks first.
      await admin.from('knowledge_chunks').delete().eq('vault_id', it.id)

      const chunks = splitIntoChunks(text.slice(0, 200000), 512, 50)
      if (chunks.length === 0) continue

      const BATCH = 20
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH)
        const res = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'text-embedding-3-small', input: batch }),
        })
        if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
        const data = await res.json() as { data: Array<{ embedding: number[] }> }
        const rows = batch.map((chunk_text, j) => ({
          vault_id:    it.id,
          chunk_index: i + j,
          chunk_text,
          embedding:   data.data[j].embedding,
          metadata:    { chunk_index: i + j, total_chunks: chunks.length },
        }))
        const { error } = await admin.from('knowledge_chunks').insert(rows)
        if (error) throw new Error(`insert: ${error.message}`)
        result.chunksWritten += rows.length
      }
      await admin.from('knowledge_vault').update({ processing_status: 'ready' }).eq('id', it.id)
      result.embedded++
    } catch (e) {
      result.failed.push(`${it.title}: ${e instanceof Error ? e.message : e}`)
    }
  }

  const { count: after } = await admin.from('knowledge_chunks').select('id', { count: 'exact', head: true })
  result.chunksAfter = after ?? 0

  return NextResponse.json({ ok: true, ...result })
}
