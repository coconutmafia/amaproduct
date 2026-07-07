'use client'

// "Анализ конкурентов" — generates a comparison table from the project's scraped
// competitor Instagram data and lets the owner preview + download it as XLSX.
import { useState } from 'react'
import { downloadXlsx } from '@/lib/utils/xlsxTable'
import { friendlyError } from '@/lib/friendlyError'
import { toast } from 'sonner'
import { Search, Loader2, Download } from 'lucide-react'

interface Row {
  handle: string; followers: string; topics: string; formats: string
  what_works: string; tone: string; posting: string; strengths: string; takeaway: string
}

const COLS: { key: keyof Row; label: string }[] = [
  { key: 'handle', label: 'Аккаунт' },
  { key: 'followers', label: 'Подписчики' },
  { key: 'topics', label: 'Темы' },
  { key: 'formats', label: 'Форматы' },
  { key: 'what_works', label: 'Что заходит' },
  { key: 'tone', label: 'Тон' },
  { key: 'posting', label: 'Регулярность' },
  { key: 'strengths', label: 'Сильные стороны' },
  { key: 'takeaway', label: 'Вывод для тебя' },
]

export function CompetitorAnalysis({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<Row[]>([])

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/ai/analyze-competitors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка анализа')
      setRows((data.competitors || []) as Row[])
      setOpen(true)
    } catch (e) {
      toast.error(friendlyError(e, 'Не удалось проанализировать'))
    } finally {
      setBusy(false)
    }
  }

  function download() {
    const aoa = [COLS.map((c) => c.label), ...rows.map((r) => COLS.map((c) => r[c.key] || ''))]
    void downloadXlsx('Анализ конкурентов', 'Конкуренты', aoa)
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        {busy ? 'Анализирую конкурентов…' : 'Анализ конкурентов (таблица)'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={() => setOpen(false)}>
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-foreground">Анализ конкурентов · {rows.length}</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={download} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
                  <Download className="h-3.5 w-3.5" /> Скачать (Excel)
                </button>
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary/40">
                  Закрыть
                </button>
              </div>
            </div>
            <div className="overflow-auto p-3">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {COLS.map((c) => (
                      <th key={c.key} className="sticky top-0 border border-border bg-secondary/40 px-2 py-1.5 text-left font-semibold text-foreground whitespace-nowrap">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {COLS.map((c) => (
                        <td key={c.key} className="border border-border px-2 py-1.5 align-top text-foreground/90 min-w-[120px]">{r[c.key]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
