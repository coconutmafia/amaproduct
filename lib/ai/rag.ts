import { createClient } from '@/lib/supabase/server'
import type { StyleExample } from '@/types'

export interface RAGContext {
  systemKnowledge: Array<{ chunk_text: string; metadata: Record<string, unknown> }>
  projectContext: Array<{ chunk_text: string; material_type: string; metadata: Record<string, unknown> }>
  styleExamples: StyleExample[]
}

async function createEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  })
  const data = await response.json()
  return data.data[0].embedding
}

export async function buildRAGContext(
  query: string,
  projectId: string,
  contentType?: string
): Promise<RAGContext> {
  const supabase = await createClient()
  const queryEmbedding = await createEmbedding(query)

  // Optimized thresholds: 0.78 for system knowledge, 0.72 for project context
  const { data: systemChunks } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: queryEmbedding,
    match_threshold: 0.78,
    match_count: 10,
  })

  const { data: projectChunks } = await supabase.rpc('match_project_chunks', {
    query_embedding: queryEmbedding,
    project_id: projectId,
    match_threshold: 0.72,
    match_count: 12,
  })

  // Fetch approved style examples for this project (few-shot learning)
  let styleExamples: StyleExample[] = []
  try {
    const query = supabase
      .from('style_examples')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('performance_score', { ascending: false })
      .limit(5)

    if (contentType) {
      query.eq('content_type', contentType)
    }

    const { data } = await query
    styleExamples = (data as StyleExample[]) || []
  } catch {
    // Style examples unavailable — continue without them
  }

  return {
    systemKnowledge: systemChunks || [],
    projectContext: projectChunks || [],
    styleExamples,
  }
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
