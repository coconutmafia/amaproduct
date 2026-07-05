import { describe, it, expect } from 'vitest'
import { splitIntoChunks, ALWAYS_INCLUDE, RAW_LIMIT, DEFAULT_RAW_LIMIT, isUsableMaterial } from '@/lib/ai/rag'

// The context chain is the product's moat. These assertions freeze the
// invariants every launch-audit fix established — a regression here silently
// degrades EVERY client's content.

describe('ALWAYS_INCLUDE chain invariants', () => {
  it('contains every critical link', () => {
    const critical = [
      'my_instagram', 'competitors', 'tone_of_voice', 'meanings_map',
      'interview_transcript', 'audience_research', 'cases_reviews',
      'product_description', 'blog_lines', 'additional', 'other',
    ]
    for (const t of critical) expect(ALWAYS_INCLUDE, `missing link: ${t}`).toContain(t)
  })

  it('long verbatim sources get generous raw budgets (LB#4)', () => {
    expect(RAW_LIMIT['interview_transcript']).toBeGreaterThanOrEqual(15000)
    expect(RAW_LIMIT['audience_research']).toBeGreaterThanOrEqual(15000)
    // medium voice/meaning materials must fit WHOLE (владелец: «ничего не срезать»)
    expect(RAW_LIMIT['my_instagram']).toBeGreaterThanOrEqual(12000)
    expect(RAW_LIMIT['meanings_map']).toBeGreaterThanOrEqual(12000)
    expect(DEFAULT_RAW_LIMIT).toBeGreaterThanOrEqual(3000)
  })

  it('placeholder/error materials are filtered from the prompt (#11)', () => {
    expect(isUsableMaterial('processing')).toBe(false)
    expect(isUsableMaterial('error')).toBe(false)
    expect(isUsableMaterial('ready')).toBe(true)
    expect(isUsableMaterial(null)).toBe(true) // legacy rows without status stay usable
  })
})

describe('splitIntoChunks', () => {
  it('covers all words with overlap and terminates', () => {
    const words = Array.from({ length: 1200 }, (_, i) => `w${i}`)
    const chunks = splitIntoChunks(words.join(' '), 512, 50)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].startsWith('w0 ')).toBe(true)
    expect(chunks[chunks.length - 1].endsWith('w1199')).toBe(true)
    // overlap: each next chunk starts 512-50 words after the previous one
    expect(chunks[1].split(' ')[0]).toBe('w462')
  })

  it('handles short input as a single chunk', () => {
    expect(splitIntoChunks('раз два три', 512, 50)).toEqual(['раз два три'])
  })
})
