import { createClient } from '@/lib/supabase/server'
import { splitIntoChunks } from '@/lib/ai/rag'

// Embed a project material's FULL text into project_chunks so nothing is lost
// even when the ALWAYS_INCLUDE raw layer truncates a very long material
// (interview transcripts, research tables run tens of thousands of chars). The
// truncated raw copy is the always-on baseline; the embedded chunks make the
// WHOLE material retrievable by semantic match. Fail-safe: never throws — a
// failed embed must not break the caller that already saved the material.
export async function embedMaterialChunks(
  materialId: string,
  projectId: string,
  text: string,
): Promise<void> {
  try {
    if (!process.env.OPENAI_API_KEY) return
    const content = (text ?? '').toString().slice(0, 200000) // safety ceiling
    if (content.trim().length < 40) return

    const chunks = splitIntoChunks(content, 512, 50)
    if (chunks.length === 0) return

    const supabase = await createClient()

    // Idempotent: drop any prior chunks for this material before re-inserting
    // (research re-runs / edits shouldn't pile up duplicates).
    await supabase.from('project_chunks').delete().eq('material_id', materialId)

    const BATCH = 20
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH)
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: batch }),
      })
      if (!res.ok) {
        console.warn('[embedMaterialChunks] OpenAI', res.status, await res.text().catch(() => ''))
        return
      }
      const data = await res.json() as { data: Array<{ embedding: number[] }> }
      const rows = batch.map((chunk_text, j) => ({
        material_id: materialId,
        project_id:  projectId,
        chunk_index: i + j,
        chunk_text,
        embedding:   data.data[j].embedding,
        metadata:    { chunk_index: i + j, total_chunks: chunks.length },
      }))
      await supabase.from('project_chunks').insert(rows)
    }
  } catch (e) {
    console.warn('[embedMaterialChunks] failed (non-fatal):', e instanceof Error ? e.message : e)
  }
}
