'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sparkles, Loader2, Info, AtSign } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  projectId:   string
  accountType: 'my_instagram' | 'competitors'
  open:        boolean
  onClose:     () => void
  onSuccess:   () => void
}

export function InstagramAccountDialog({ projectId, accountType, open, onClose, onSuccess }: Props) {
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isOwn = accountType === 'my_instagram'

  const submit = async () => {
    const v = url.trim()
    if (!v) { toast.error('Вставь ссылку или @handle Instagram-аккаунта'); return }
    setSubmitting(true)
    const loadingToast = toast.loading('Подгружаю данные из Instagram (~30-60 секунд)...')
    try {
      const res = await fetch('/api/instagram/scrape', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId, instagramUrl: v, accountType }),
      })
      if (!res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? 'Ошибка')
      }
      if (!res.body) throw new Error('Нет ответа от сервера')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', done = false, errMsg = ''

      while (true) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const ev of parts) {
          const line = ev.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          try {
            const m = JSON.parse(line.slice(6)) as { type: string; message?: string }
            if (m.type === 'status' && m.message) toast.loading(m.message, { id: loadingToast })
            else if (m.type === 'done')  done = true
            else if (m.type === 'error') errMsg = m.message ?? 'Ошибка'
          } catch { /* heartbeat */ }
        }
      }

      if (errMsg) throw new Error(errMsg)
      if (!done) throw new Error('Связь оборвалась — обнови страницу через минуту, аккаунт мог сохраниться.')

      toast.dismiss(loadingToast)
      toast.success('Аккаунт добавлен и проанализирован')
      setUrl('')
      onSuccess()
      onClose()
    } catch (err) {
      toast.dismiss(loadingToast)
      toast.error(err instanceof Error ? err.message : 'Ошибка добавления аккаунта', { duration: 20000 })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting && !v) onClose() }}>
      <DialogContent className="sm:max-w-lg border-border bg-card">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <AtSign className="h-4 w-4 text-primary" />
            {isOwn ? 'Подключить свой Instagram' : 'Добавить аккаунт конкурента'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          <div className="flex gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <span>
              {isOwn
                ? 'Подгружу профиль и последние 25 постов, AI сделает разбор твоего голоса и позиционирования. Аккаунт должен быть публичным.'
                : 'Подгружу профиль и последние 25 постов конкурента, AI разберёт что у них работает и чему можно научиться. Аккаунт должен быть публичным.'}
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Ссылка или @handle</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={submitting}
              placeholder="instagram.com/username  или  @username"
              className="text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) submit() }}
            />
            <p className="text-[11px] text-muted-foreground/70">Подойдёт любой формат: полная ссылка, instagram.com/username, или просто @username.</p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" disabled={submitting} onClick={onClose}>Отмена</Button>
            <Button onClick={submit} disabled={submitting || !url.trim()} className="gradient-accent text-white hover:opacity-90 border-0">
              {submitting
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Подгружаю...</>
                : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Подгрузить и разобрать</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
