import { describe, it, expect } from 'vitest'
import { CHECKLIST, DIAGNOSIS_BANDS, diagnose, MAX_SCORE, TOTAL_ITEMS } from '@/lib/blogAudit/checklist'

describe('blog-audit checklist', () => {
  it('has 10 blocks × 5 items = 50 items, max 100 points', () => {
    expect(CHECKLIST).toHaveLength(10)
    for (const b of CHECKLIST) expect(b.items).toHaveLength(5)
    expect(TOTAL_ITEMS).toBe(50)
    expect(MAX_SCORE).toBe(100)
  })

  it('has unique block keys', () => {
    const keys = CHECKLIST.map(b => b.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('marks visual/highlights blocks as not-assessable-from-text', () => {
    const visual = CHECKLIST.find(b => b.key === 'visual')!
    const highlights = CHECKLIST.find(b => b.key === 'highlights')!
    expect(visual.items.every(i => !i.fromText)).toBe(true)
    expect(highlights.items.every(i => !i.fromText)).toBe(true)
  })

  it('keeps a meaningful share of items assessable from text', () => {
    const assessable = CHECKLIST.flatMap(b => b.items).filter(i => i.fromText).length
    expect(assessable).toBeGreaterThanOrEqual(30) // ~36 today; text carries the score
    expect(assessable).toBeLessThan(TOTAL_ITEMS)  // some genuinely need manual review
  })

  it('diagnosis bands cover 0..100 contiguously', () => {
    expect(DIAGNOSIS_BANDS[0].min).toBe(0)
    expect(DIAGNOSIS_BANDS[DIAGNOSIS_BANDS.length - 1].max).toBe(100)
    for (let i = 1; i < DIAGNOSIS_BANDS.length; i++) {
      expect(DIAGNOSIS_BANDS[i].min).toBe(DIAGNOSIS_BANDS[i - 1].max + 1)
    }
  })

  it('diagnose maps scores to the right band and clamps out-of-range', () => {
    expect(diagnose(0)).toBe(DIAGNOSIS_BANDS[0].label)
    expect(diagnose(45)).toBe(DIAGNOSIS_BANDS[1].label)
    expect(diagnose(70)).toBe(DIAGNOSIS_BANDS[2].label)
    expect(diagnose(100)).toBe(DIAGNOSIS_BANDS[4].label)
    expect(diagnose(150)).toBe(DIAGNOSIS_BANDS[4].label) // clamp high
    expect(diagnose(-20)).toBe(DIAGNOSIS_BANDS[0].label) // clamp low
  })
})
