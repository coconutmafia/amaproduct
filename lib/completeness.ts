// Single source of truth for the project "knowledge base completeness" score.
// Used by: upload route (recalc on add), materials route (recalc on delete),
// and KnowledgePageClient (live display). Keeping the weights here prevents
// the three copies from drifting apart.
//
// Client-safe — no server-only imports.

export const COMPLETENESS_WEIGHTS: Record<string, number> = {
  tone_of_voice:       25,
  unpacking_map:       15,
  cases_reviews:       15,
  marketing_strategy:  15,
  funnel_description:  10,
  audience_research:   10,
  blog_lines:          10,
  competitors:          5,
  product_description:  5,
}

// Разделы, слитые в интерфейсе в один блок: вес зачитывается, если есть ЛЮБОЙ
// из типов. «Воронки» слиты с тактикой (4 августа) — новые клиенты грузят всё
// как marketing_tactics, и вес воронок не должен стать недостижимым.
const MERGED_SATISFIES: Record<string, string[]> = {
  funnel_description: ['funnel_description', 'marketing_tactics'],
}

/** Compute the 0-100 completeness score from the set of ready material types. */
export function computeCompleteness(readyTypes: Iterable<string>): number {
  const set = new Set(readyTypes)
  let score = 0
  for (const [type, weight] of Object.entries(COMPLETENESS_WEIGHTS)) {
    const satisfiedBy = MERGED_SATISFIES[type] ?? [type]
    if (satisfiedBy.some((t) => set.has(t))) score += weight
  }
  return Math.min(100, score)
}
