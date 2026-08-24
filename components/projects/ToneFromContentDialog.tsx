'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Sparkles, Loader2, Info, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyError } from '@/lib/friendlyError'

interface Props {
  projectId: string
  open:      boolean
  onClose:   () => void
  onSuccess: () => void
}

export function ToneFromContentDialog({ projectId, open, onClose, onSuccess }: Props) {
  const [units, setUnits]         = useState<string[]>(Array(10).fill(''))
  const [submitting, setSubmitting] = useState(false)

  const setUnit = (i: number, v: string) =>
    setUnits(prev => prev.map((u, j) => (j === i ? v : u)))

  const filled = units.filter(u => u.trim().length >= 30).length

  const submit = async () => {
    if (filled < 3) {
      toast.error('Заполни минимум 3 поля (по 30+ символов). Лучше 7-10 — будет точнее.')
      return
    }
    setSubmitting(true)
    // Фон + поллинг (24.08, свип класса «мобильная вкладка убивает долгий
    // запрос»): сервер отвечает 202 сразу и анализирует в after(); статус
    // живёт в материале tone_of_voice — страницу можно закрывать, ToV доедет.
    const loadingToast = toast.loading('Анализирую твои тексты (~1 минута). Страницу можно закрыть — ToV сохранится сам.')
    try {
      const res = await fetch('/api/ai/extract-tone-of-voice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId, units: units.map(u => u.trim()).filter(u => u.length >= 30) }),
      })
      if (res.status !== 202) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? 'Ошибка')
      }

      const deadline = Date.now() + 5 * 60_000
      let outcome: 'ready' | 'error' | 'timeout' = 'timeout'
      let errText = ''
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 4000))
        try {
          const st = await fetch(`/api/materials/tov-status?projectId=${projectId}`)
          if (!st.ok) continue
          const s = await st.json() as { status?: string; error?: string }
          if (s.status === 'ready') { outcome = 'ready'; break }
          if (s.status === 'error') { outcome = 'error'; errText = s.error ?? 'Ошибка извлечения ToV'; break }
        } catch { /* сеть моргнула — продолжаем поллить */ }
      }

      toast.dismiss(loadingToast)
      if (outcome === 'ready') {
        toast.success('Tone of Voice извлечён и сохранён в материалы')
        onSuccess()
        onClose()
      } else if (outcome === 'error') {
        throw new Error(errText)
      } else {
        toast.message('ToV ещё анализируется — обнови страницу через минуту, он появится в материалах.', { duration: 15000 })
        onClose()
      }
    } catch (err) {
      toast.dismiss(loadingToast)
      toast.error(friendlyError(err, 'Ошибка извлечения ToV'), { duration: 30000 })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting && !v) onClose() }}>
      <DialogContent className="sm:max-w-2xl border-border bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Tone of Voice из твоих текстов</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {/* Critical warning — own writing only */}
          <div className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">Важно: только тексты, которые ты писала САМА</p>
              <p>Не вставляй контент, сгенерированный ChatGPT, Claude или другим AI — иначе сервис заберёт чужой стиль вместо твоего. Возьми свои живые посты, сторис, сценарии рилз — то, что выходит из тебя без правок AI.</p>
            </div>
          </div>

          <div className="flex gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <span>
              Идеально 7-10 текстов. Минимум 3. Каждый — от 30 символов. Подойдут: посты, расшифровки твоих сторис/рилз, длинные комментарии — любая твоя «авторская речь».
              <span className="block mt-1 font-medium text-foreground/80">Заполнено: {filled} / 10</span>
            </span>
          </div>

          <div className="space-y-2">
            {units.map((u, i) => (
              <div key={i} className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Пост / текст {i + 1}{i < 3 ? ' *' : ''}</label>
                <textarea
                  value={u}
                  onChange={e => setUnit(i, e.target.value)}
                  disabled={submitting}
                  rows={3}
                  placeholder={i === 0 ? 'Вставь сюда полный текст одного из твоих постов / сторис / рилз...' : ''}
                  className="w-full text-sm border border-border rounded-lg p-2.5 resize-y focus:outline-none focus:border-primary/50 text-foreground bg-background disabled:opacity-60"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" disabled={submitting} onClick={onClose}>Отмена</Button>
            <Button onClick={submit} disabled={submitting || filled < 3} className="gradient-accent text-white hover:opacity-90 border-0">
              {submitting
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Анализирую...</>
                : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Извлечь Tone of Voice</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
