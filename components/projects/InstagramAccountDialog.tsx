'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sparkles, Loader2, Info, AtSign } from 'lucide-react'
import { toast } from 'sonner'
import { pollJob } from '@/lib/jobs/pollJob'

interface Props {
  projectId:      string
  accountType:    'my_instagram' | 'competitors'
  remainingSlots: number // how many accounts of this type can still be added
  open:           boolean
  onClose:        () => void
  onSuccess:      () => void
}

export function InstagramAccountDialog({ projectId, accountType, remainingSlots, open, onClose, onSuccess }: Props) {
  const isOwn = accountType === 'my_instagram'
  // Own account = 1 field. Competitors = one field per remaining slot (up to 5).
  const fieldCount = isOwn ? 1 : Math.min(Math.max(remainingSlots, 1), 5)

  const [urls, setUrls] = useState<string[]>(Array(fieldCount).fill(''))
  const [submitting, setSubmitting] = useState(false)

  const setUrl = (i: number, v: string) => setUrls(prev => prev.map((u, j) => (j === i ? v : u)))

  // Scrape + analyze ONE account — enqueues a background job (roadmap #8
  // pattern) and polls it, so a locked/backgrounded phone doesn't lose the
  // in-flight analysis the way a held-open SSE connection would.
  const scrapeOne = async (v: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/instagram/scrape', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId, instagramUrl: v, accountType }),
      })
      const startBody = await res.json().catch(() => ({})) as { jobId?: string; error?: string }
      if (!res.ok || !startBody.jobId) return { ok: false, error: startBody.error ?? 'Ошибка' }

      await pollJob(startBody.jobId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Ошибка' }
    }
  }

  const submit = async () => {
    const filled = urls.map(u => u.trim()).filter(Boolean)
    if (filled.length === 0) {
      toast.error(isOwn ? 'Вставь ссылку на свой аккаунт' : 'Заполни хотя бы один аккаунт конкурента')
      return
    }
    setSubmitting(true)
    const loadingToast = toast.loading('Анализирую Instagram-аккаунты...')
    let okCount = 0
    const fails: string[] = []
    try {
      for (let i = 0; i < filled.length; i++) {
        toast.loading(
          `Анализирую аккаунт ${i + 1} из ${filled.length} — ~30-60 секунд каждый. Не закрывай страницу.`,
          { id: loadingToast },
        )
        const r = await scrapeOne(filled[i])
        if (r.ok) okCount++
        else fails.push(`${filled[i]}: ${r.error}`)
      }
      toast.dismiss(loadingToast)
      if (okCount > 0) toast.success(`Добавлено и проанализировано: ${okCount}`)
      if (fails.length > 0) {
        toast.error(`Не удалось: ${fails.length}`, { description: fails.join('\n'), duration: 15000 })
      }
      if (okCount > 0) { onSuccess(); onClose() }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting && !v) onClose() }}>
      <DialogContent className="sm:max-w-lg border-border bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <AtSign className="h-4 w-4 text-primary" />
            {isOwn ? 'Подключить свой Instagram' : 'Добавить аккаунты конкурентов'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          <div className="flex gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <span>
              {isOwn
                ? 'Подгружу профиль и последние 25 постов, AI сделает разбор твоего голоса и позиционирования. Аккаунт должен быть публичным.'
                : `Можешь добавить до ${fieldCount} аккаунтов сразу — заполни нужные поля. По каждому подгружу профиль и 25 постов, AI разберёт что у них работает. Аккаунты должны быть публичными. Каждый анализируется ~30-60 секунд.`}
            </span>
          </div>

          <div className="space-y-2">
            {urls.map((u, i) => (
              <div key={i} className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {isOwn ? 'Ссылка или @handle' : `Конкурент ${i + 1}${i === 0 ? ' *' : ' (необязательно)'}`}
                </label>
                <Input
                  value={u}
                  onChange={(e) => setUrl(i, e.target.value)}
                  disabled={submitting}
                  placeholder="instagram.com/username  или  @username"
                  className="text-sm"
                />
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground/70">Подойдёт любой формат: полная ссылка, instagram.com/username, или просто @username.</p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" disabled={submitting} onClick={onClose}>Отмена</Button>
            <Button onClick={submit} disabled={submitting || urls.every(u => !u.trim())} className="gradient-accent text-white hover:opacity-90 border-0">
              {submitting
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Анализирую...</>
                : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Подгрузить и разобрать</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
