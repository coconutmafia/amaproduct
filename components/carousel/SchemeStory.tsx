'use client'

// «Сторис-схема» — stages joined by hand-drawn connectors on a dark backdrop
// (owner request). The user types an optional intro + the stages (one per line);
// we render it via the slide engine's `scheme` template.

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'
import { GitBranch, Loader2, Download } from 'lucide-react'
import { VoiceTextarea } from '@/components/ui/VoiceTextarea'

type SchemeBrand = { accentColor?: string; font?: string; accentStyle?: 'gradient' | 'flat' }

export function SchemeStory({ projectId }: { projectId: string }) {
  const [intro, setIntro] = useState('')
  const [stepsText, setStepsText] = useState('')
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  // Load the brand kit so schemes render in the creator's accent + font (the
  // scheme template fixes its own dark bg, so only accent/font/accentStyle matter).
  const [brand, setBrand] = useState<SchemeBrand | undefined>()
  useEffect(() => {
    if (!projectId) return
    fetch(`/api/brand-kit?projectId=${projectId}`).then((r) => r.json()).then((d) => {
      if (d && !d.error) setBrand({ accentColor: d.accentColor || undefined, font: d.font || undefined, accentStyle: d.accentStyle === 'flat' ? 'flat' : 'gradient' })
    }).catch(() => {})
  }, [projectId])

  async function build() {
    const steps = stepsText.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6)
    if (steps.length < 2) { toast.error('Добавь хотя бы 2 этапа — каждый с новой строки'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/carousel/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slide: { kind: 'scheme', index: 0, total: 1, headline: intro.trim() || undefined, steps }, format: 'story', projectId, brand }),
      })
      if (!res.ok) throw new Error('Не удалось собрать схему — попробуй ещё раз')
      const blob = await res.blob()
      setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
    } catch (e) {
      toast.error(friendlyError(e, 'Ошибка'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
          <GitBranch className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Сторис-схема</p>
          <p className="text-xs text-muted-foreground">Этапы, связанные линиями, на тёмном фоне. Ключевое слово выдели **звёздочками**.</p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <VoiceTextarea value={intro} onChange={setIntro} rows={2}
          placeholder="Вступление сверху (необязательно) — напиши или надиктуй" />
        <textarea value={stepsText} onChange={(e) => setStepsText(e.target.value)} rows={5}
          placeholder={'Этапы — каждый с новой строки:\nисследование её **ЦА**\nупаковка в **смыслы**\nворонки\nеё личный **продукт**'}
          className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm" />
      </div>

      <button type="button" onClick={build} disabled={busy}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
        {busy ? 'Собираю схему…' : 'Собрать схему'}
      </button>

      {url && (
        <div className="mt-3 space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Сторис-схема" className="mx-auto max-h-96 rounded-xl border border-border" />
          <a href={url} download="story-scheme.png"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90">
            <Download className="h-3.5 w-3.5" /> Скачать
          </a>
        </div>
      )}
    </section>
  )
}
