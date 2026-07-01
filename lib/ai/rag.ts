import { createClient } from '@/lib/supabase/server'
import type { StyleExample } from '@/types'

export interface RAGContext {
  systemKnowledge: Array<{ chunk_text: string; metadata: Record<string, unknown> }>
  projectContext: Array<{ chunk_text: string; material_type: string; metadata: Record<string, unknown> }>
  styleExamples: StyleExample[]
  // Standing per-project rules the blogger dictated («не пиши…», «всегда…») —
  // injected prominently into the system prompt, top priority.
  voiceRules?: string
}

// Per-material_type raw_content budget for the ALWAYS_INCLUDE layer (chars).
// Long verbatim sources carry the audience's own language and must reach the
// model in full-ish; short curated maps stay small.
export const DEFAULT_RAW_LIMIT = 3000
// Tuned against real project data (Этап-2 live inspector run): the owner's core
// voice/meaning materials run 9–12k chars and a blanket 3000 cut dropped most of
// the moat (my_instagram 11.9k, meanings_map 11.4k, blog_lines/cases ~10k). Opus
// has a 200k window — spend it on the highest-value context. Short curated
// materials (funnel/strategy/tactics/product) keep the small default.
export const RAW_LIMIT: Record<string, number> = {
  // Long verbatim sources: keep a generous raw baseline; their FULL text is also
  // embedded into project_chunks (research-analyze → embedMaterialChunks), so the
  // whole material is retrievable by relevance — nothing is lost to the cut.
  interview_transcript: 15000,
  audience_research:     15000,
  // Medium curated materials: cap set ABOVE the owner's real sizes so they reach
  // generation WHOLE, never truncated (my_instagram 11.9k, meanings_map 11.4k,
  // cases 10.4k, blog_lines 9.4k, competitors ≤11k — all fit).
  audience_survey:       15000,
  meanings_map:          15000, // карта смыслов — core audience language
  my_instagram:          15000, // owner's own voice (bio + posts)
  cases_reviews:         15000, // social proof — several cases
  blog_lines:            15000, // narrative lines
  competitors:           12000, // per competitor account
  tone_of_voice:          8000, // explicit ToV
  unpacking_map:          6000, // personality / story
}

// Materials still processing or failed hold placeholder/diagnostic text
// («⏳ анализируется…», «❌ Ошибка …\n\nСтек: …»), NOT real content. They must
// never be fed to generation as if they were the tone of voice / a case / etc.
export const BLOCKED_STATUS = new Set(['processing', 'error', 'failed', 'pending'])
export const isUsableMaterial = (status: unknown) =>
  !BLOCKED_STATUS.has((status as string) ?? '')

// Curated identity/voice material types pulled RAW (not via embedding) into
// every generation. Exported so the context inspector reads the exact same
// source of truth (no drift between what generation uses and what QA shows).
export const ALWAYS_INCLUDE = [
  'my_instagram',        // own IG profile + posts analysis
  'competitors',         // competitor IG accounts analysis
  'tone_of_voice',       // explicit ToV
  'meanings_map',        // audience language map
  'unpacking_map',       // personality / story
  'blog_lines',          // narrative lines
  'audience_research',   // research tables / audience analysis
  'interview_transcript',// raw customer-interview quotes — prime audience language
  'audience_survey',     // survey results
  'additional',          // user-uploaded extra materials
  'cases_reviews',       // client cases & reviews
  'funnel_description',  // sales funnel
  'marketing_strategy',  // marketing strategy
  'marketing_tactics',   // marketing tactics
  'product_description', // product
  'content_reference',   // reference content
  'chatbot_description', // chatbots
  'other',               // uploader "Другое" — a misc catch-all the user chose
                         // to attach; must reach generation like 'additional'
                         // (also recovers pre-fix scrape-social rows saved as 'other')
] as const

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
    // Thresholds calibrated for text-embedding-3-small: relevant cosine sims for
    // this model sit ~0.3–0.5, so the old 0.78/0.72 gates returned almost nothing
    // even when chunks existed (the methodology foundation never surfaced). Lower
    // gates + higher counts so the system methodology and project embeddings
    // actually reach generation.
    const [sysResult, projResult] = await Promise.all([
      supabase.rpc('match_knowledge_chunks', {
        query_embedding: embedding,
        match_threshold: 0.35,
        match_count: 14,
      }),
      supabase.rpc('match_project_chunks', {
        query_embedding: embedding,
        project_id: projectId,
        match_threshold: 0.4,
        match_count: 14,
      }),
    ])
    systemChunks = (sysResult.data as typeof systemChunks) || []
    projectChunks = (projResult.data as typeof projectChunks) || []
  } else {
    // ── Fallback: direct queries without embeddings ───────────────────────
    // Load system knowledge vault chunks (all ready chunks, most recent first)
    const { data: sysRaw } = await supabase
      .from('knowledge_chunks')
      .select('chunk_text, metadata')
      .order('created_at', { ascending: false })
      .limit(15)

    // If no knowledge_chunks, try knowledge_vault itself
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
        .select('title, material_type, raw_content, processing_status')
        .eq('project_id', projectId)
        .limit(10)

      if (materials) {
        projectChunks = materials
          .filter(m => m.raw_content && isUsableMaterial(m.processing_status))
          .map(m => ({
            chunk_text: `[${m.material_type}] ${m.title}:\n${(m.raw_content ?? '').slice(0, 800)}`,
            material_type: m.material_type as string,
            metadata: {},
          }))
      }
    }

  }

  // ── ALWAYS include curated identity/voice materials ───────────────────────
  // Runs for BOTH branches (embedding search AND fallback). AI-generated
  // materials (my_instagram, competitors, meanings_map, …) are never embedded
  // into project_chunks, so the vector-search branch would otherwise drop
  // them entirely. We pull raw_content directly and merge on top, deduped.
  // Every substantive material the user uploads must reach generation — not
  // just the voice set. Previously cases/funnel/strategy/tactics were left to
  // the embedding match (unreliable), so the AI often said "у меня нет кейсов".
  // ALWAYS_INCLUDE is now a module-level export (source of truth, shared with
  // the context inspector).
  const { data: alwaysMats } = await supabase
    .from('project_materials')
    .select('title, material_type, raw_content, processing_status')
    .eq('project_id', projectId)
    .in('material_type', [...ALWAYS_INCLUDE])

  if (alwaysMats && alwaysMats.length > 0) {
    // De-dup key must NOT collapse two distinct long materials that share a
    // title prefix (e.g. two customer interviews saved the same day). Key on
    // material_type + full title + length + a wider content sample.
    const rawKey = (mt: string, title: string, raw: string) =>
      `${mt}::${title}::${raw.length}::${raw.slice(0, 120)}`
    const seen = new Set(projectChunks.map(c => `${c.material_type}::${c.chunk_text.slice(0, 120)}`))
    for (const m of alwaysMats) {
      if (!isUsableMaterial(m.processing_status)) continue
      const raw = (m.raw_content ?? '').toString()
      if (!raw.trim()) continue
      // Per-type budget. Long raw materials (interview transcripts, research
      // tables, surveys) hold the audience's own language — the whole point of
      // the moat — so a blanket 3000-char cut dropped ~95% of a 60-min
      // interview. Cases/funnel/strategy stay at the smaller default (they hold
      // several short items; 3000 ≈ a few cases).
      const limit = RAW_LIMIT[m.material_type as string] ?? DEFAULT_RAW_LIMIT
      const chunk_text = `[${m.material_type}] ${m.title}:\n${raw.slice(0, limit)}`
      const key = rawKey(m.material_type as string, (m.title ?? '').toString(), raw)
      if (seen.has(key)) continue
      seen.add(key)
      projectChunks.push({ chunk_text, material_type: m.material_type as string, metadata: {} })
    }
  }

  // ── Style examples (approved content for few-shot learning) ──────────────
  // Priority: explicit style bank → the project's saved "Готовое" library →
  // system examples. Each source is in its own try so one failing table never
  // drops the examples already gathered.
  let styleExamples: StyleExample[] = []

  // 1. Explicit style bank (style_examples) — highest priority
  try {
    const personalQuery = supabase
      .from('style_examples')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('performance_score', { ascending: false })
      .limit(5)

    if (contentType) {
      personalQuery.eq('content_type', contentType)
    }

    const { data: personalData } = await personalQuery
    styleExamples = (personalData as StyleExample[]) || []
  } catch {
    // style_examples unavailable
  }

  // 2. Supplement with the project's saved "Готовое" library (saved_content).
  //    Content the user keeps as "готовое" IS what the AI should learn the voice
  //    from — the same promise the user sees in the library badge. Deduped, ≤5.
  //    No hard content_type filter: most chat saves land as 'other'/null, and a
  //    voice example of another format still teaches the voice — we just PREFER
  //    same-format rows by sorting them first.
  if (styleExamples.length < 5) {
    try {
      const { data: savedData } = await supabase
        .from('saved_content')
        .select('id, project_id, content_type, title, body, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(12)

      const rows = ((savedData as Array<{ id: string; project_id: string | null; content_type: string | null; title: string | null; body: string; created_at: string }>) || [])
        .sort((a, b) => (contentType ? Number(b.content_type === contentType) - Number(a.content_type === contentType) : 0))

      const seen = new Set(styleExamples.map(e => (e.body_text || '').slice(0, 80)))
      for (const s of rows) {
        if (styleExamples.length >= 5) break
        const body = (s.body || '').trim()
        if (body.length < 40) continue
        const key = body.slice(0, 80)
        if (seen.has(key)) continue
        seen.add(key)
        styleExamples.push({
          id: s.id,
          project_id: s.project_id ?? projectId,
          content_type: (s.content_type ?? 'post') as StyleExample['content_type'],
          title: s.title ?? null,
          body_text: body,
          warmup_phase: null,
          performance_score: 0,
          tags: ['saved'],
          is_active: true,
          source_content_item_id: null,
          created_at: s.created_at,
        })
      }
    } catch {
      // saved_content unavailable (e.g. migration not applied) — skip silently
    }
  }

  // 3. Still thin? Supplement with system-level examples.
  if (styleExamples.length < 3) {
    try {
      const needed = 5 - styleExamples.length
      const systemQuery = supabase
        .from('style_examples')
        .select('*')
        .eq('is_system', true)
        .eq('is_active', true)
        .order('performance_score', { ascending: false })
        .limit(needed)

      if (contentType) {
        systemQuery.eq('content_type', contentType)
      }

      const { data: systemData } = await systemQuery
      const systemExamples = (systemData as StyleExample[]) || []
      styleExamples = [...styleExamples, ...systemExamples]
    } catch {
      // system examples unavailable
    }
  }

  // ── Standing voice rules (owner-dictated, e.g. via 📌 in the chat) ────────
  let voiceRules: string | undefined
  try {
    // Take the most recent row rather than .maybeSingle() — the latter throws
    // a 406 (PGRST116) if more than one voice_rules row ever exists, which would
    // silently drop the whole layer. order+limit(1) is robust to duplicates.
    const { data: rulesRows } = await supabase
      .from('project_materials')
      .select('raw_content')
      .eq('project_id', projectId)
      .eq('material_type', 'voice_rules')
      .order('updated_at', { ascending: false })
      .limit(1)
    const raw = (rulesRows?.[0]?.raw_content as string | null)?.trim()
    if (raw) voiceRules = raw.slice(0, 3000)
  } catch { /* unavailable */ }

  return { systemKnowledge: systemChunks, projectContext: projectChunks, styleExamples, voiceRules }
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
