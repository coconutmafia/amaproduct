import { createClient } from '@/lib/supabase/server'
import type { StyleExample } from '@/types'

export interface RAGContext {
  systemKnowledge: Array<{ chunk_text: string; metadata: Record<string, unknown> }>
  projectContext: Array<{ chunk_text: string; material_type: string; metadata: Record<string, unknown> }>
  styleExamples: StyleExample[]
}

// Try OpenAI embedding — returns null if key missing or request fails
async function tryCreateEmbedding(text: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    })
    if (!response.ok) return null
    const data = await response.json() as { data?: Array<{ embedding: number[] }> }
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}

export async function buildRAGContext(
  query: string,
  projectId: string,
  contentType?: string
): Promise<RAGContext> {
  const supabase = await createClient()

  // ── Try embedding-based search first ─────────────────────────────────────
  const embedding = await tryCreateEmbedding(query)

  let systemChunks: Array<{ chunk_text: string; metadata: Record<string, unknown> }> = []
  let projectChunks: Array<{ chunk_text: string; material_type: string; metadata: Record<string, unknown> }> = []

  if (embedding) {
    // Semantic search via vector similarity
    const [sysResult, projResult] = await Promise.all([
      supabase.rpc('match_knowledge_chunks', {
        query_embedding: embedding,
        match_threshold: 0.78,
        match_count: 10,
      }),
      supabase.rpc('match_project_chunks', {
        query_embedding: embedding,
        project_id: projectId,
        match_threshold: 0.72,
        match_count: 12,
      }),
    ])
    systemChunks = (sysResult.data as typeof systemChunks) || []
    projectChunks = (projResult.data as typeof projectChunks) || []
  } else {
    // ── Fallback: direct queries without embeddings ───────────────────────
    // Load system knowledge vault chunks (all ready chunks, most recent first)
    const { data: sysRaw } = await supabase
      .from('knowledge_vault_chunks')
      .select('chunk_text, metadata')
      .order('created_at', { ascending: false })
      .limit(15)

    // If no knowledge_vault_chunks table, try knowledge_vault itself
    if (!sysRaw || sysRaw.length === 0) {
      const { data: vaultItems } = await supabase
        .from('knowledge_vault')
        .select('raw_content, content_type, title')
        .eq('processing_status', 'ready')
        .limit(5)

      if (vaultItems) {
        systemChunks = vaultItems
          .filter(v => v.raw_content)
          .map(v => ({
            chunk_text: `[${v.content_type}] ${v.title}:\n${(v.raw_content ?? '').slice(0, 1000)}`,
            metadata: { content_type: v.content_type },
          }))
      }
    } else {
      systemChunks = sysRaw.map(r => ({
        chunk_text: r.chunk_text as string,
        metadata: (r.metadata as Record<string, unknown>) || {},
      }))
    }

    // Load project chunks directly
    const { data: projRaw } = await supabase
      .from('project_chunks')
      .select('chunk_text, material_type, metadata')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (projRaw && projRaw.length > 0) {
      projectChunks = projRaw.map(r => ({
        chunk_text: r.chunk_text as string,
        material_type: r.material_type as string,
        metadata: (r.metadata as Record<string, unknown>) || {},
      }))
    } else {
      // If no chunks yet — load raw content from project_materials
      const { data: materials } = await supabase
        .from('project_materials')
        .select('title, material_type, raw_content')
        .eq('project_id', projectId)
        .limit(10)

      if (materials) {
        projectChunks = materials
          .filter(m => m.raw_content)
          .map(m => ({
            chunk_text: `[${m.material_type}] ${m.title}:\n${(m.raw_content ?? '').slice(0, 800)}`,
            material_type: m.material_type as string,
            metadata: {},
          }))
      }
    }
  }

  // ── Style examples (approved content for few-shot learning) ──────────────
  let styleExamples: StyleExample[] = []
  try {
    const styleQuery = supabase
      .from('style_examples')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('performance_score', { ascending: false })
      .limit(5)

    if (contentType) {
      styleQuery.eq('content_type', contentType)
    }

    const { data } = await styleQuery
    styleExamples = (data as StyleExample[]) || []
  } catch {
    // Style examples unavailable
  }

  return { systemKnowledge: systemChunks, projectContext: projectChunks, styleExamples }
}

export function splitIntoChunks(text: string, chunkSize = 512, overlap = 50): string[] {
  const words = text.split(/\s+/)
  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length)
    chunks.push(words.slice(start, end).join(' '))
    start += chunkSize - overlap
  }

  return chunks
}
